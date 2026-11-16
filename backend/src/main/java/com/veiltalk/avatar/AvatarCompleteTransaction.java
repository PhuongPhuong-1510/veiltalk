package com.veiltalk.avatar;

import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.HashMap;
import java.util.Map;
import java.util.UUID;

import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import com.veiltalk.auth.UnauthorizedException;
import com.veiltalk.auth.User;
import com.veiltalk.auth.UserRepository;
import com.veiltalk.user.UserProfileResponse;
import jakarta.persistence.EntityManager;

@Service
public class AvatarCompleteTransaction {
	private final UserRepository users;
	private final AvatarProfileRepository profiles;
	private final AvatarPortraitCleanupJobRepository cleanupJobs;
	private final EntityManager entityManager;

	public AvatarCompleteTransaction(UserRepository users, AvatarProfileRepository profiles,
			AvatarPortraitCleanupJobRepository cleanupJobs, EntityManager entityManager) {
		this.users = users; this.profiles = profiles; this.cleanupJobs = cleanupJobs; this.entityManager = entityManager;
	}

	@Transactional
	public AvatarCompleteResponse complete(UUID userId, UUID requestId, UUID expectedRevision,
			String payloadHash, String objectKey, AvatarModel model, Map<String, Object> customizations, Instant now) {
		User user = users.findActiveByIdForUpdate(userId).orElseThrow(() -> new UnauthorizedException("Invalid session"));
		AvatarProfile profile = profiles.findByUserId(userId).orElse(null);
		if (profile != null && requestId.equals(profile.getLastSaveRequestId())) {
			if (!payloadHash.equals(profile.getLastSavePayloadHash()))
				throw new AvatarConflictException("IDEMPOTENCY_CONFLICT", "request_id was already used with different data");
			return response(profile, user);
		}
		if (expectedRevision == null) {
			if (profile != null) throw new AvatarConflictException("AVATAR_ALREADY_EXISTS", "Avatar already exists");
			profile = new AvatarProfile(); profile.setUserId(userId);
		} else if (profile == null || !expectedRevision.equals(profile.getProfileRevision())) {
			throw new AvatarConflictException("AVATAR_REVISION_CONFLICT", "Avatar was changed in another session");
		}
		String previousObjectKey = profile.getPortraitObjectKey();
		profile.setModelId(model.id()); profile.setModelUrl(model.modelUrl());
		profile.setCustomizations(new HashMap<>(customizations)); profile.setProfileRevision(UUID.randomUUID());
		profile.setPortraitObjectKey(objectKey); profile.setPortraitVersion(requestId); profile.setPortraitUpdatedAt(now);
		profile.setLastSaveRequestId(requestId); profile.setLastSavePayloadHash(payloadHash);
		profiles.saveAndFlush(profile);
		user.setAvatarUrl(AvatarPortraitResolver.customPortraitUrl(userId, requestId)); users.saveAndFlush(user);
		entityManager.refresh(profile);
		entityManager.refresh(user);
		if (previousObjectKey != null && !previousObjectKey.equals(objectKey))
			cleanupJobs.save(AvatarPortraitCleanupJob.after(previousObjectKey, now.plus(24, ChronoUnit.HOURS)));
		return response(profile, user);
	}

	private AvatarCompleteResponse response(AvatarProfile profile, User user) {
		return new AvatarCompleteResponse(AvatarService.toResponse(profile), new UserProfileResponse(
				user.getId(), user.getEmail(), user.getUsername(), user.getDisplayName(), user.getAvatarUrl(),
				user.getRole().getDatabaseValue(), true, user.getCreatedAt()));
	}
}
