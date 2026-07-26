package com.veiltalk.video;

import java.time.Clock;
import java.util.List;
import java.util.UUID;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

/**
 * P2-T24 — dọn dẹp video 'recording' khi xóa tài khoản (API 4.5, 7.5; TC-37).
 *
 * <p>Gọi từ {@code UserAccountService.deleteAccount} SAU khi soft-delete user + revoke token
 * đã commit. Mọi lỗi ở đây bị nuốt (không throw ra ngoài) và mọi ghi DB chạy trong transaction
 * REQUIRES_NEW riêng ({@link VideoCleanupTransactionSupport}) — vì vậy không bao giờ làm
 * rollback việc xóa tài khoản, đúng yêu cầu API Design mục 4.5.
 */
@Service
public class VideoAccountCleanupService {

	private static final Logger LOGGER = LoggerFactory.getLogger(VideoAccountCleanupService.class);

	private final VideoRepository videoRepository;
	private final VideoMultipartStorage multipartStorage;
	private final VideoUploadSessionStore sessionStore;
	private final RedisDistributedLock distributedLock;
	private final VideoCleanupTransactionSupport transactionSupport;
	private final Clock clock;

	@Autowired
	VideoAccountCleanupService(
			VideoRepository videoRepository,
			VideoMultipartStorage multipartStorage,
			VideoUploadSessionStore sessionStore,
			RedisDistributedLock distributedLock,
			VideoCleanupTransactionSupport transactionSupport) {
		this(videoRepository, multipartStorage, sessionStore, distributedLock, transactionSupport,
				Clock.systemUTC());
	}

	VideoAccountCleanupService(
			VideoRepository videoRepository,
			VideoMultipartStorage multipartStorage,
			VideoUploadSessionStore sessionStore,
			RedisDistributedLock distributedLock,
			VideoCleanupTransactionSupport transactionSupport,
			Clock clock) {
		this.videoRepository = videoRepository;
		this.multipartStorage = multipartStorage;
		this.sessionStore = sessionStore;
		this.distributedLock = distributedLock;
		this.transactionSupport = transactionSupport;
		this.clock = clock;
	}

	public void abortAllRecordingsForUser(UUID userId) {
		List<Video> recordings = videoRepository.findRecordingByUserId(userId);
		for (Video video : recordings) {
			try {
				abortOne(video);
			} catch (RuntimeException exception) {
				LOGGER.error("VIDEO_ACCOUNT_CLEANUP_UNEXPECTED_FAILURE videoId={}",
						video.getId(), exception);
			}
		}
	}

	private void abortOne(Video video) {
		String uploadId = resolveUploadId(video);
		if (uploadId == null) {
			// upload_id không xác định (video tạo trước P2-T24 và Redis session đã hết hạn):
			// không thể gọi AbortMultipartUpload vì thiếu tham số bắt buộc. Chấp nhận cho MVP —
			// soft-delete record, đa phần mồ côi trên MinIO cần rà soát thủ công qua bucket.
			LOGGER.warn("VIDEO_CLEANUP_UPLOAD_ID_UNKNOWN videoId={} objectKey={}: bỏ qua abort MinIO",
					video.getId(), video.getStoragePath());
			transactionSupport.softDeleteRecording(video.getId(), clock.instant());
			deleteSessionQuietly(video.getId());
			return;
		}

		try (var lock = distributedLock.acquire("video:operation-lock:" + video.getId())) {
			multipartStorage.abortMultipartUpload(video.getStoragePath(), uploadId);
			transactionSupport.softDeleteRecording(video.getId(), clock.instant());
			deleteSessionQuietly(video.getId());
		} catch (RuntimeException exception) {
			// Không rollback: MinIO abort lỗi ⇒ giữ video 'recording' (như POST /videos/{id}/abort
			// lúc lỗi), ghi cleanup job bền vững để VideoCleanupRetryJob thử lại.
			LOGGER.error("VIDEO_CLEANUP_ABORT_FAILED videoId={} objectKey={}: ghi cleanup job retry",
					video.getId(), video.getStoragePath(), exception);
			transactionSupport.recordAbortCleanupJob(
					video.getId(), video.getStoragePath(), uploadId, clock.instant());
		}
	}

	private String resolveUploadId(Video video) {
		if (video.getUploadId() != null) {
			return video.getUploadId();
		}
		return sessionStore.findSession(video.getId())
				.map(VideoUploadSessionStore.UploadSession::uploadId)
				.orElse(null);
	}

	private void deleteSessionQuietly(UUID videoId) {
		try {
			sessionStore.deleteSession(videoId);
		} catch (RuntimeException exception) {
			LOGGER.error("Không thể dọn Redis session sau cleanup xóa tài khoản cho video {}",
					videoId, exception);
		}
	}
}
