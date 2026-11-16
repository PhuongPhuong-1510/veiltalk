package com.veiltalk.avatar;

import java.time.Instant;
import java.util.UUID;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Table;

@Entity
@Table(name = "avatar_portrait_cleanup_jobs")
public class AvatarPortraitCleanupJob {
	@Id @GeneratedValue(strategy = GenerationType.UUID)
	private UUID id;
	@Column(name = "object_key", nullable = false, length = 500)
	private String objectKey;
	@Column(nullable = false)
	private int attempts;
	@Column(name = "next_attempt_at", nullable = false)
	private Instant nextAttemptAt;
	@Column(name = "last_error", length = 1000)
	private String lastError;

	public static AvatarPortraitCleanupJob after(String objectKey, Instant when) {
		var job = new AvatarPortraitCleanupJob();
		job.objectKey = objectKey;
		job.nextAttemptAt = when;
		return job;
	}
	public UUID getId() { return id; }
	public String getObjectKey() { return objectKey; }
	public int getAttempts() { return attempts; }
	public void setAttempts(int attempts) { this.attempts = attempts; }
	public Instant getNextAttemptAt() { return nextAttemptAt; }
	public void setNextAttemptAt(Instant nextAttemptAt) { this.nextAttemptAt = nextAttemptAt; }
	public void setLastError(String lastError) { this.lastError = lastError; }
}
