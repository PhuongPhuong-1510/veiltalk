package com.veiltalk.avatar;

import java.time.Instant;
import java.util.HashMap;
import java.util.Map;
import java.util.UUID;

import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.PrePersist;
import jakarta.persistence.Table;

@Entity
@Table(name = "avatar_profiles")
public class AvatarProfile {

	@Id
	@GeneratedValue(strategy = GenerationType.UUID)
	private UUID id;

	@Column(name = "user_id", nullable = false)
	private UUID userId;

	@Column(name = "model_id", nullable = false, length = 100)
	private String modelId;

	@Column(name = "model_url", nullable = false, length = 500)
	private String modelUrl;

	@JdbcTypeCode(SqlTypes.JSON)
	@Column(nullable = false, columnDefinition = "jsonb")
	private Map<String, Object> customizations = new HashMap<>();

	@Column(name = "profile_revision", nullable = false)
	private UUID profileRevision;

	@Column(name = "portrait_object_key", length = 500)
	private String portraitObjectKey;

	@Column(name = "portrait_version")
	private UUID portraitVersion;

	@Column(name = "portrait_updated_at")
	private Instant portraitUpdatedAt;

	@Column(name = "last_save_request_id")
	private UUID lastSaveRequestId;

	@Column(name = "last_save_payload_hash", length = 64)
	private String lastSavePayloadHash;

	@Column(name = "created_at", nullable = false, insertable = false, updatable = false)
	private Instant createdAt;

	@Column(name = "updated_at", nullable = false, insertable = false, updatable = false)
	private Instant updatedAt;

	public AvatarProfile() {
	}

	@PrePersist
	void initializeRevision() {
		if (profileRevision == null) profileRevision = UUID.randomUUID();
	}

	public UUID getId() {
		return id;
	}

	public void setId(UUID id) {
		this.id = id;
	}

	public UUID getUserId() {
		return userId;
	}

	public void setUserId(UUID userId) {
		this.userId = userId;
	}

	public String getModelId() {
		return modelId;
	}

	public void setModelId(String modelId) {
		this.modelId = modelId;
	}

	public String getModelUrl() {
		return modelUrl;
	}

	public void setModelUrl(String modelUrl) {
		this.modelUrl = modelUrl;
	}

	public Map<String, Object> getCustomizations() {
		return customizations;
	}

	public void setCustomizations(Map<String, Object> customizations) {
		this.customizations = customizations;
	}

	public UUID getProfileRevision() { return profileRevision; }
	public void setProfileRevision(UUID profileRevision) { this.profileRevision = profileRevision; }
	public String getPortraitObjectKey() { return portraitObjectKey; }
	public void setPortraitObjectKey(String portraitObjectKey) { this.portraitObjectKey = portraitObjectKey; }
	public UUID getPortraitVersion() { return portraitVersion; }
	public void setPortraitVersion(UUID portraitVersion) { this.portraitVersion = portraitVersion; }
	public Instant getPortraitUpdatedAt() { return portraitUpdatedAt; }
	public void setPortraitUpdatedAt(Instant portraitUpdatedAt) { this.portraitUpdatedAt = portraitUpdatedAt; }
	public UUID getLastSaveRequestId() { return lastSaveRequestId; }
	public void setLastSaveRequestId(UUID lastSaveRequestId) { this.lastSaveRequestId = lastSaveRequestId; }
	public String getLastSavePayloadHash() { return lastSavePayloadHash; }
	public void setLastSavePayloadHash(String lastSavePayloadHash) { this.lastSavePayloadHash = lastSavePayloadHash; }

	public Instant getCreatedAt() {
		return createdAt;
	}

	public Instant getUpdatedAt() {
		return updatedAt;
	}
}
