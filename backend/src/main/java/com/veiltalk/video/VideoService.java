package com.veiltalk.video;

import java.time.Instant;
import java.util.Comparator;
import java.util.List;
import java.util.UUID;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.util.StringUtils;

import com.veiltalk.auth.ForbiddenException;
import com.veiltalk.auth.ConflictException;
import com.veiltalk.auth.NotFoundException;
import com.veiltalk.auth.ValidationException;

import jakarta.persistence.EntityManager;

@Service
public class VideoService {

	private static final Logger LOGGER = LoggerFactory.getLogger(VideoService.class);

	// Chunk đầu tiên của phiên multipart luôn là part số 1.
	private static final int FIRST_PART_NUMBER = 1;

	private final VideoRepository videoRepository;
	private final VideoMultipartStorage multipartStorage;
	private final VideoUploadSessionStore sessionStore;
	private final VideoProperties videoProperties;
	private final EntityManager entityManager;
	private final RedisDistributedLock distributedLock;

	public VideoService(
			VideoRepository videoRepository,
			VideoMultipartStorage multipartStorage,
			VideoUploadSessionStore sessionStore,
			VideoProperties videoProperties,
			EntityManager entityManager,
			RedisDistributedLock distributedLock) {
		this.videoRepository = videoRepository;
		this.multipartStorage = multipartStorage;
		this.sessionStore = sessionStore;
		this.videoProperties = videoProperties;
		this.entityManager = entityManager;
		this.distributedLock = distributedLock;
	}

	@Transactional
	public CreateVideoResponse initiateUpload(UUID userId, CreateVideoRequest request) {
		// 1) Quota (NFR-19): chỉ tính video status='ready'; recording/processing/failed không tính.
		long usedBytes = videoRepository.sumReadyFileSizeBytes(userId);
		if (usedBytes + request.estimatedSizeBytes() > videoProperties.storageLimitBytes()) {
			throw new StorageQuotaExceededException(
					"Dung lượng tài khoản không đủ để chứa video này. Hãy xóa bớt video cũ.");
		}

		String format = StringUtils.hasText(request.format()) ? request.format() : "mp4";

		// 2) Gọi MinIO TRƯỚC khi insert để nếu MinIO lỗi thì không sinh record 'recording' mồ côi.
		// objectKey phải cố định suốt phiên (create → upload part → finalize dùng chung key);
		// dùng một UUID riêng cho key, không phụ thuộc id do DB sinh.
		String storageKey = "videos/" + UUID.randomUUID() + "/source." + format;
		String uploadId = multipartStorage.createMultipartUpload(storageKey);
		String firstChunkUrl = multipartStorage.presignPartUrl(storageKey, uploadId, FIRST_PART_NUMBER);

		// 3) Tạo record videos status='recording'. file_size_bytes có CHECK > 0 nên lưu tạm
		// estimated (đã validate > 0); giá trị thật ghi đè khi webhook báo ready (P2-T23).
		Video video = new Video();
		video.setUserId(userId);
		video.setTitle(request.title());
		video.setStoragePath(storageKey);
		video.setFileSizeBytes(request.estimatedSizeBytes());
		video.setFormat(format);
		video.setStatus(VideoStatus.RECORDING);

		videoRepository.saveAndFlush(video);
		// created_at do DB sinh (insertable=false) — refresh để đọc lại giá trị.
		entityManager.refresh(video);

		// 4) Gieo phiên multipart vào Redis để P2-T21 tích lũy ETag theo part.
		// Lỗi ở đây ném ra ⇒ transaction rollback ⇒ không sinh record 'recording' mồ côi.
		// Multipart đã tạo trên MinIO để background timeout job (P2-T22) dọn — KHÔNG abort ở đây.
		try {
			sessionStore.createSession(
					video.getId(), uploadId, userId, request.chunkSizeBytes());
		} catch (RuntimeException exception) {
			// Không log credential hay URL đã ký — chỉ định danh phiên để lần dấu.
			LOGGER.error("Không thể gieo phiên upload vào Redis cho video {} (objectKey={})",
					video.getId(), storageKey, exception);
			throw new VideoStorageException("Không thể khởi tạo phiên upload", exception);
		}

		return new CreateVideoResponse(
				video.getId(),
				video.getTitle(),
				video.getStatus().getDatabaseValue(),
				uploadId,
				firstChunkUrl,
				FIRST_PART_NUMBER,
				video.getCreatedAt());
	}

	/**
	 * P2-T21 — POST /videos/{id}/chunks: ghi nhận ETag của part vừa PUT (part_number - 1),
	 * kiểm tra thứ tự/idempotency/quota nguyên tử trong Redis, rồi cấp presigned URL cho part
	 * tiếp theo. etag_previous trong request K là ETag của part K-1.
	 */
	@Transactional(readOnly = true)
	public ChunkUrlResponse requestNextChunk(UUID userId, UUID videoId, ChunkUrlRequest request) {
		// 1) Tồn tại + không bị xóa mềm → 404 (đồng thời che luôn 'phiên đã kết thúc').
		Video video = videoRepository.findById(videoId)
				.filter(candidate -> candidate.getDeletedAt() == null)
				.orElseThrow(() -> new NotFoundException(
						"Video không tồn tại hoặc phiên upload đã kết thúc."));

		// 2) Sở hữu → 403.
		if (!video.getUserId().equals(userId)) {
			throw new ForbiddenException("Video không thuộc về bạn.");
		}

		// 3) Chỉ phiên đang quay mới nhận thêm chunk; processing/ready/failed thì phiên đã đóng.
		if (video.getStatus() != VideoStatus.RECORDING) {
			throw new NotFoundException("Phiên upload không còn hiệu lực.");
		}

		// 4) readyBytes từ DB (chỉ video 'ready'); Lua tính quota ước lượng bảo thủ với chunkSize.
		long readyBytes = videoRepository.sumReadyFileSizeBytes(userId);
		VideoUploadSessionStore.ReserveResult result = sessionStore.reserveNextPart(
				videoId,
				request.uploadId(),
				request.partNumber(),
				request.etagPrevious(),
				readyBytes,
				videoProperties.storageLimitBytes());

		switch (result) {
			case OK, RETRY -> {
				// OK: lần đầu cấp part này. RETRY: cấp lại đúng part cũ (không nhân đôi ETag).
				String chunkUrl = multipartStorage.presignPartUrl(
						video.getStoragePath(), request.uploadId(), request.partNumber());
				return new ChunkUrlResponse(
						chunkUrl,
						request.partNumber(),
						videoProperties.presignedUrlExpirySeconds());
			}
			case ERR_NO_SESSION -> throw new NotFoundException(
					"Video không tồn tại hoặc phiên upload đã kết thúc.");
			case ERR_QUOTA -> throw new StorageQuotaExceededException(
					"Dung lượng ước tính đã vượt hạn mức. Hãy dừng và hủy phiên quay này.");
			case ERR_UPLOAD -> throw new ValidationException("upload_id không hợp lệ.");
			case ERR_ETAG -> throw new ValidationException(
					"etag_previous không khớp với ETag đã ghi nhận cho part này.");
			case ERR_ORDER -> throw new ValidationException(
					"part_number không đúng thứ tự của phiên upload.");
			default -> throw new IllegalStateException("Kết quả reserveNextPart không xác định: " + result);
		}
	}

	public FinalizeVideoResponse finalizeUpload(
			UUID userId, UUID videoId, FinalizeVideoRequest request) {
		validateRequestParts(request.parts());
		try (var quotaLock = distributedLock.acquire("video:quota-lock:" + userId);
				var videoLock = distributedLock.acquire("video:operation-lock:" + videoId)) {
			Video video = requireOwnedRecording(userId, videoId);
			VideoUploadSessionStore.UploadSession session = requireSession(videoId);
			validateUploadId(userId, request.uploadId(), session);
			validateRedisEtags(request.parts(), session);

			List<VideoMultipartStorage.UploadedPart> actualParts =
					multipartStorage.listParts(video.getStoragePath(), request.uploadId()).stream()
							.sorted(Comparator.comparingInt(
									VideoMultipartStorage.UploadedPart::partNumber))
							.toList();
			validateMinioParts(request.parts(), actualParts);
			long actualUploadedBytes = sumPartSizes(actualParts);
			long reservedBytes = videoRepository.sumQuotaReservedBytes(userId);
			if (reservedBytes > videoProperties.storageLimitBytes() - actualUploadedBytes) {
				multipartStorage.abortMultipartUpload(video.getStoragePath(), request.uploadId());
				int updated = videoRepository.failAndSoftDeleteRecording(videoId, Instant.now());
				sessionStore.deleteSession(videoId);
				if (updated != 1) {
					throw new VideoOperationConflictException(
							"Trạng thái video đã thay đổi khi xử lý quota.");
				}
				throw new StorageQuotaExceededException(
						"Dung lượng thực tế vượt hạn mức. Phiên quay đã được hủy.");
			}

			multipartStorage.completeMultipartUpload(
					video.getStoragePath(), request.uploadId(), actualParts);
			int updated;
			try {
				updated = videoRepository.markProcessing(
						videoId, request.durationSecs(), actualUploadedBytes);
			} catch (RuntimeException databaseFailure) {
				cleanupCompletedObject(video, databaseFailure);
				sessionStore.deleteSession(videoId);
				throw databaseFailure;
			}
			if (updated != 1) {
				RuntimeException stateFailure = new VideoOperationConflictException(
						"Video đã được xử lý bởi thao tác khác.");
				cleanupCompletedObject(video, stateFailure);
				sessionStore.deleteSession(videoId);
				throw stateFailure;
			}
			sessionStore.deleteSession(videoId);
			return new FinalizeVideoResponse(videoId, VideoStatus.PROCESSING.getDatabaseValue(),
					"Upload hoàn tất, đang xử lý. Trạng thái sẽ cập nhật qua MinIO webhook.");
		}
	}

	public void abortUpload(UUID userId, UUID videoId, AbortVideoRequest request) {
		try (var videoLock = distributedLock.acquire("video:operation-lock:" + videoId)) {
			Video video = requireOwnedRecording(userId, videoId);
			VideoUploadSessionStore.UploadSession session = requireSession(videoId);
			validateUploadId(userId, request.uploadId(), session);
			multipartStorage.abortMultipartUpload(video.getStoragePath(), request.uploadId());
			int updated = videoRepository.failAndSoftDeleteRecording(videoId, Instant.now());
			sessionStore.deleteSession(videoId);
			if (updated != 1) {
				throw new VideoOperationConflictException(
						"Video đã được xử lý bởi thao tác khác.");
			}
		}
	}

	private Video requireOwnedRecording(UUID userId, UUID videoId) {
		Video video = videoRepository.findById(videoId)
				.filter(candidate -> candidate.getDeletedAt() == null)
				.orElseThrow(() -> new NotFoundException("Video không tồn tại."));
		if (!video.getUserId().equals(userId)) {
			throw new ForbiddenException("Video không thuộc về bạn.");
		}
		if (video.getStatus() != VideoStatus.RECORDING) {
			throw new ConflictException("Video đã được finalize hoặc không còn ghi hình.");
		}
		return video;
	}

	private VideoUploadSessionStore.UploadSession requireSession(UUID videoId) {
		return sessionStore.findSession(videoId)
				.orElseThrow(() -> new NotFoundException("Phiên upload không tồn tại hoặc đã hết hạn."));
	}

	private void validateUploadId(
			UUID userId, String uploadId, VideoUploadSessionStore.UploadSession session) {
		if (!session.userId().equals(userId) || !session.uploadId().equals(uploadId)) {
			throw new NotFoundException("Phiên upload không tồn tại hoặc upload_id không hợp lệ.");
		}
	}

	private void validateRequestParts(List<FinalizeVideoRequest.PartRequest> parts) {
		for (int index = 0; index < parts.size(); index++) {
			if (parts.get(index).partNumber() != index + 1) {
				throw new ValidationException(
						"parts phải liên tục từ 1..N, đúng thứ tự và không trùng.");
			}
		}
	}

	private void validateRedisEtags(
			List<FinalizeVideoRequest.PartRequest> parts,
			VideoUploadSessionStore.UploadSession session) {
		if (session.nextPartNumber() != parts.size() + 1
				|| session.etags().size() != Math.max(0, parts.size() - 1)) {
			throw new ValidationException("Danh sách parts không khớp thứ tự phiên upload.");
		}
		for (int partNumber = 1; partNumber < parts.size(); partNumber++) {
			String stored = session.etags().get(partNumber);
			if (stored == null || !normalizeEtag(stored).equals(
					normalizeEtag(parts.get(partNumber - 1).etag()))) {
				throw new ValidationException("ETag request không khớp ETag đã lưu trong Redis.");
			}
		}
	}

	private void validateMinioParts(
			List<FinalizeVideoRequest.PartRequest> requestParts,
			List<VideoMultipartStorage.UploadedPart> actualParts) {
		if (actualParts.size() != requestParts.size()) {
			throw new ValidationException("Danh sách parts không đầy đủ trên MinIO.");
		}
		for (int index = 0; index < actualParts.size(); index++) {
			var requested = requestParts.get(index);
			var actual = actualParts.get(index);
			if (actual.partNumber() != requested.partNumber()
					|| !normalizeEtag(actual.etag()).equals(normalizeEtag(requested.etag()))) {
				throw new ValidationException("Part number hoặc ETag không khớp MinIO.");
			}
		}
	}

	private long sumPartSizes(List<VideoMultipartStorage.UploadedPart> parts) {
		try {
			long total = 0;
			for (var part : parts) {
				if (part.sizeBytes() <= 0) {
					throw new ValidationException("MinIO trả về kích thước part không hợp lệ.");
				}
				total = Math.addExact(total, part.sizeBytes());
			}
			return total;
		} catch (ArithmeticException exception) {
			throw new ValidationException("Tổng kích thước video không hợp lệ.");
		}
	}

	static String normalizeEtag(String etag) {
		String value = etag.trim();
		if (value.length() >= 2 && value.startsWith("\"") && value.endsWith("\"")) {
			return value.substring(1, value.length() - 1);
		}
		return value;
	}

	private void cleanupCompletedObject(Video video, RuntimeException primaryFailure) {
		try {
			multipartStorage.removeObject(video.getStoragePath());
		} catch (RuntimeException cleanupFailure) {
			primaryFailure.addSuppressed(cleanupFailure);
			LOGGER.error("ORPHAN_VIDEO_OBJECT cleanup thất bại cho video {} objectKey={}; "
					+ "cần P2-T24 retry", video.getId(), video.getStoragePath(), cleanupFailure);
		}
	}
}
