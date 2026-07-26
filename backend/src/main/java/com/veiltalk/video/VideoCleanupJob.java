package com.veiltalk.video;

import java.time.Instant;
import java.util.UUID;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Table;

/**
 * Bản ghi bền vững cho một thao tác MinIO cần retry sau khi lần gọi đầu tiên thất bại.
 *
 * <p>Dùng chung cho hai nguồn (P2-T24): abort multipart khi xóa tài khoản (ABORT_MULTIPART)
 * và dọn object mồ côi của {@link VideoTimeoutCleanupJob} (REMOVE_OBJECT). Cả hai đều cùng
 * một hình trạng: "một thao tác MinIO idempotent cần thử lại có backoff, giới hạn số lần".
 */
@Entity
@Table(name = "video_cleanup_jobs")
public class VideoCleanupJob {

	@Id
	@GeneratedValue(strategy = GenerationType.UUID)
	private UUID id;

	@Column(name = "video_id", nullable = false)
	private UUID videoId;

	@Column(name = "storage_path", nullable = false, length = 500)
	private String storagePath;

	@Column(name = "upload_id", length = 255)
	private String uploadId;

	@Enumerated(EnumType.STRING)
	@Column(nullable = false, length = 20)
	private VideoCleanupOperation operation;

	@Enumerated(EnumType.STRING)
	@Column(nullable = false, length = 20)
	private VideoCleanupJobStatus status = VideoCleanupJobStatus.PENDING;

	@Column(nullable = false)
	private int attempts = 0;

	@Column(name = "next_attempt_at", nullable = false)
	private Instant nextAttemptAt;

	@Column(name = "last_error", length = 1000)
	private String lastError;

	@Column(name = "created_at", nullable = false, insertable = false, updatable = false)
	private Instant createdAt;

	@Column(name = "updated_at", nullable = false, insertable = false, updatable = false)
	private Instant updatedAt;

	public VideoCleanupJob() {
	}

	public static VideoCleanupJob abortMultipart(
			UUID videoId, String storagePath, String uploadId, Instant now) {
		VideoCleanupJob job = new VideoCleanupJob();
		job.videoId = videoId;
		job.storagePath = storagePath;
		job.uploadId = uploadId;
		job.operation = VideoCleanupOperation.ABORT_MULTIPART;
		job.nextAttemptAt = now;
		return job;
	}

	public static VideoCleanupJob removeObject(UUID videoId, String storagePath, Instant now) {
		VideoCleanupJob job = new VideoCleanupJob();
		job.videoId = videoId;
		job.storagePath = storagePath;
		job.operation = VideoCleanupOperation.REMOVE_OBJECT;
		job.nextAttemptAt = now;
		return job;
	}

	public UUID getId() {
		return id;
	}

	public UUID getVideoId() {
		return videoId;
	}

	public String getStoragePath() {
		return storagePath;
	}

	public String getUploadId() {
		return uploadId;
	}

	public VideoCleanupOperation getOperation() {
		return operation;
	}

	public VideoCleanupJobStatus getStatus() {
		return status;
	}

	public void setStatus(VideoCleanupJobStatus status) {
		this.status = status;
	}

	public int getAttempts() {
		return attempts;
	}

	public void setAttempts(int attempts) {
		this.attempts = attempts;
	}

	public Instant getNextAttemptAt() {
		return nextAttemptAt;
	}

	public void setNextAttemptAt(Instant nextAttemptAt) {
		this.nextAttemptAt = nextAttemptAt;
	}

	public String getLastError() {
		return lastError;
	}

	public void setLastError(String lastError) {
		this.lastError = lastError;
	}
}
