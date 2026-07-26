package com.veiltalk.video;

import java.time.Instant;
import java.util.UUID;

import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

/**
 * Ghi thay đổi DB liên quan cleanup trong transaction RIÊNG (REQUIRES_NEW), tách biệt bean
 * để tránh self-invocation (proxy Spring chỉ chặn được lời gọi xuyên bean).
 *
 * <p>Dùng bởi {@link VideoAccountCleanupService} — service này chạy bên trong transaction
 * của {@code UserAccountService.deleteAccount}; nếu MinIO abort thất bại, ghi cleanup job
 * PHẢI commit độc lập, không được kéo theo rollback soft-delete/revoke token của tài khoản
 * (và ngược lại, một lỗi ở đây không được làm rollback thao tác xóa tài khoản).
 */
@Service
class VideoCleanupTransactionSupport {

	private final VideoRepository videoRepository;
	private final VideoCleanupJobRepository cleanupJobRepository;

	VideoCleanupTransactionSupport(
			VideoRepository videoRepository, VideoCleanupJobRepository cleanupJobRepository) {
		this.videoRepository = videoRepository;
		this.cleanupJobRepository = cleanupJobRepository;
	}

	@Transactional(propagation = Propagation.REQUIRES_NEW)
	void softDeleteRecording(UUID videoId, Instant now) {
		videoRepository.failAndSoftDeleteRecording(videoId, now);
	}

	@Transactional(propagation = Propagation.REQUIRES_NEW)
	void recordAbortCleanupJob(UUID videoId, String storagePath, String uploadId, Instant now) {
		cleanupJobRepository.save(VideoCleanupJob.abortMultipart(videoId, storagePath, uploadId, now));
	}
}
