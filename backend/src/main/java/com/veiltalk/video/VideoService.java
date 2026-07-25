package com.veiltalk.video;

import java.util.UUID;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.util.StringUtils;

import com.veiltalk.auth.ForbiddenException;
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

	public VideoService(
			VideoRepository videoRepository,
			VideoMultipartStorage multipartStorage,
			VideoUploadSessionStore sessionStore,
			VideoProperties videoProperties,
			EntityManager entityManager) {
		this.videoRepository = videoRepository;
		this.multipartStorage = multipartStorage;
		this.sessionStore = sessionStore;
		this.videoProperties = videoProperties;
		this.entityManager = entityManager;
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
}
