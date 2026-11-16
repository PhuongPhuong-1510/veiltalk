package com.veiltalk.avatar;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.time.Instant;
import java.util.HexFormat;
import java.util.Map;
import java.util.Set;
import java.util.TreeMap;
import java.util.UUID;
import java.util.regex.Pattern;

import org.springframework.stereotype.Service;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.veiltalk.auth.NotFoundException;
import com.veiltalk.auth.UnauthorizedException;
import com.veiltalk.auth.UserRepository;
import com.veiltalk.auth.ValidationException;

@Service
public class AvatarService {
	private static final Pattern HEX_COLOR = Pattern.compile("^#[0-9a-fA-F]{6}$");
	private static final Set<String> COLOR_SLOTS = Set.of("hair", "outfit", "eyes", "accessory", "aura");
	private static final int MAX_MATERIAL_OVERRIDES = 64;
	private static final int MAX_CUSTOMIZATIONS_BYTES = 32_768;

	private final AvatarProfileRepository profiles;
	private final AvatarModelCatalogService catalog;
	private final UserRepository users;
	private final AvatarPortraitStorage storage;
	private final AvatarPortraitImageProcessor images;
	private final AvatarCompleteTransaction transaction;
	private final AvatarPortraitCleanupJobRepository cleanupJobs;
	private final ObjectMapper objectMapper;

	public AvatarService(AvatarProfileRepository profiles, AvatarModelCatalogService catalog,
			UserRepository users, AvatarPortraitStorage storage, AvatarPortraitImageProcessor images,
			AvatarCompleteTransaction transaction, AvatarPortraitCleanupJobRepository cleanupJobs,
			ObjectMapper objectMapper) {
		this.profiles = profiles; this.catalog = catalog; this.users = users; this.storage = storage;
		this.images = images; this.transaction = transaction; this.objectMapper = objectMapper;
		this.cleanupJobs = cleanupJobs;
	}

	public AvatarCompleteResponse complete(UUID userId, UUID requestId, UUID expectedRevision,
			String modelId, String customizationsJson, byte[] portraitUpload) {
		if (users.findByIdAndDeletedAtIsNull(userId).isEmpty()) throw new UnauthorizedException("Invalid session");
		AvatarModel model = catalog.findById(modelId).orElseThrow(() -> new ValidationException("Invalid model_id"));
		Map<String, Object> customizations = parseCustomizations(customizationsJson);
		validateCustomizations(model, customizations);
		byte[] png = images.validateAndSanitize(portraitUpload);
		String payloadHash = hash(modelId, customizations, png);
		String objectKey = "avatars/" + userId + "/" + requestId + "-" + payloadHash + ".png";
		storage.put(objectKey, png);
		try {
			return transaction.complete(userId, requestId, expectedRevision, payloadHash, objectKey, model, customizations, Instant.now());
		} catch (RuntimeException exception) {
			try { storage.remove(objectKey); }
			catch (RuntimeException cleanupFailure) {
				exception.addSuppressed(cleanupFailure);
				try { cleanupJobs.save(AvatarPortraitCleanupJob.after(objectKey, Instant.now())); }
				catch (RuntimeException jobFailure) { exception.addSuppressed(jobFailure); }
			}
			throw exception;
		}
	}

	public AvatarProfileResponse getOwnAvatar(UUID userId) {
		if (users.findByIdAndDeletedAtIsNull(userId).isEmpty()) throw new UnauthorizedException("Invalid session");
		return profiles.findByUserId(userId).map(AvatarService::toResponse)
				.orElseThrow(() -> new NotFoundException("Avatar not found"));
	}

	public AvatarPublicResponse getUserAvatar(UUID userId) {
		if (users.findByIdAndDeletedAtIsNull(userId).isEmpty()) throw new NotFoundException("Avatar not found");
		AvatarProfile profile = profiles.findByUserId(userId).orElseThrow(() -> new NotFoundException("Avatar not found"));
		return new AvatarPublicResponse(profile.getUserId(), profile.getModelId(), profile.getModelUrl(), profile.getCustomizations());
	}

	public Portrait portrait(UUID userId) {
		AvatarProfile profile = profiles.findByUserId(userId)
				.filter(value -> value.getPortraitObjectKey() != null && value.getPortraitVersion() != null)
				.orElseThrow(() -> new NotFoundException("Avatar portrait not found"));
		return new Portrait(storage.get(profile.getPortraitObjectKey()), profile.getPortraitVersion());
	}

	private Map<String, Object> parseCustomizations(String json) {
		if (json == null || json.getBytes(StandardCharsets.UTF_8).length > MAX_CUSTOMIZATIONS_BYTES)
			throw new ValidationException("customizations is too large");
		try {
			Map<String, Object> value = objectMapper.readValue(json, new TypeReference<>() {});
			return value == null ? Map.of() : value;
		} catch (Exception exception) { throw new ValidationException("customizations must be valid JSON"); }
	}

	private void validateCustomizations(AvatarModel model, Map<String, Object> customizations) {
		Set<String> supported = Set.copyOf(model.supportedCustomizations());
		for (String key : customizations.keySet()) if (!supported.contains(key)) throw new ValidationException("Unsupported customization: " + key);
		Object colorValue = customizations.get("colors");
		if (colorValue != null) {
			if (!(colorValue instanceof Map<?, ?> colors)) throw new ValidationException("colors must be an object");
			for (var entry : colors.entrySet()) {
				if (!(entry.getKey() instanceof String slot) || !COLOR_SLOTS.contains(slot)) throw new ValidationException("Unsupported color slot");
				if (entry.getValue() != null && !isHex(entry.getValue())) throw new ValidationException("Invalid color value");
			}
		}
		Object overrideValue = customizations.get("materialOverrides");
		if (overrideValue != null) {
			if (!(overrideValue instanceof Map<?, ?> overrides) || overrides.size() > MAX_MATERIAL_OVERRIDES) throw new ValidationException("Invalid materialOverrides");
			for (var entry : overrides.entrySet()) {
				if (!(entry.getKey() instanceof String key) || key.isBlank() || key.length() > 200 || !isHex(entry.getValue()))
					throw new ValidationException("Invalid material override");
			}
		}
	}

	private boolean isHex(Object value) { return value instanceof String color && HEX_COLOR.matcher(color).matches(); }

	private String hash(String modelId, Map<String, Object> customizations, byte[] png) {
		try {
			MessageDigest digest = MessageDigest.getInstance("SHA-256");
			digest.update(modelId.getBytes(StandardCharsets.UTF_8));
			digest.update(objectMapper.writeValueAsBytes(new TreeMap<>(customizations)));
			digest.update(png);
			return HexFormat.of().formatHex(digest.digest());
		} catch (Exception exception) { throw new IllegalStateException("Could not hash avatar payload", exception); }
	}

	static AvatarProfileResponse toResponse(AvatarProfile profile) {
		return new AvatarProfileResponse(profile.getId(), profile.getUserId(), profile.getModelId(), profile.getModelUrl(),
				profile.getCustomizations(), profile.getProfileRevision(), profile.getPortraitVersion(),
				profile.getLastSaveRequestId(), profile.getCreatedAt(), profile.getUpdatedAt());
	}

	public record Portrait(byte[] bytes, UUID version) {}
}
