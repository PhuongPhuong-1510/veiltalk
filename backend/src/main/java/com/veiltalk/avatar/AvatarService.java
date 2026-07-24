package com.veiltalk.avatar;

import java.util.HashMap;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import com.veiltalk.auth.UnauthorizedException;
import com.veiltalk.auth.UserRepository;
import com.veiltalk.auth.ValidationException;
import com.veiltalk.auth.NotFoundException;

@Service
public class AvatarService {

	private static final String INVALID_SESSION_MESSAGE = "Invalid session";
	private static final String AVATAR_NOT_FOUND_MESSAGE = "Avatar not found";

	private final AvatarProfileRepository avatarProfileRepository;
	private final AvatarModelCatalogService catalogService;
	private final UserRepository userRepository;

	public AvatarService(
			AvatarProfileRepository avatarProfileRepository,
			AvatarModelCatalogService catalogService,
			UserRepository userRepository) {
		this.avatarProfileRepository = avatarProfileRepository;
		this.catalogService = catalogService;
		this.userRepository = userRepository;
	}

	@Transactional
	public UpsertResult upsert(UUID authenticatedUserId, AvatarUpsertRequest request) {
		requireActiveUser(authenticatedUserId);
		AvatarModel model = catalogService.findById(request.modelId())
				.orElseThrow(() -> new ValidationException("Invalid model_id"));
		Map<String, Object> customizations = request.customizations() == null
				? Map.of()
				: request.customizations();
		validateCustomizations(model, customizations);

		var existingProfile = avatarProfileRepository.findByUserId(authenticatedUserId);
		AvatarProfile profile = existingProfile.orElseGet(AvatarProfile::new);
		profile.setUserId(authenticatedUserId);
		profile.setModelId(model.id());
		profile.setModelUrl(model.modelUrl());
		profile.setCustomizations(new HashMap<>(customizations));
		avatarProfileRepository.saveAndFlush(profile);
		return new UpsertResult(existingProfile.isEmpty());
	}

	@Transactional(readOnly = true)
	public AvatarProfileResponse getOwnAvatar(UUID authenticatedUserId) {
		requireActiveUser(authenticatedUserId);
		AvatarProfile profile = avatarProfileRepository.findByUserId(authenticatedUserId)
				.orElseThrow(this::avatarNotFound);
		return new AvatarProfileResponse(
				profile.getId(),
				profile.getUserId(),
				profile.getModelId(),
				profile.getModelUrl(),
				profile.getCustomizations(),
				profile.getCreatedAt(),
				profile.getUpdatedAt());
	}

	@Transactional(readOnly = true)
	public AvatarPublicResponse getUserAvatar(UUID userId) {
		if (userRepository.findByIdAndDeletedAtIsNull(userId).isEmpty()) {
			throw avatarNotFound();
		}
		AvatarProfile profile = avatarProfileRepository.findByUserId(userId)
				.orElseThrow(this::avatarNotFound);
		return new AvatarPublicResponse(
				profile.getUserId(),
				profile.getModelId(),
				profile.getModelUrl(),
				profile.getCustomizations());
	}

	private void validateCustomizations(AvatarModel model, Map<String, Object> customizations) {
		Set<String> supportedKeys = Set.copyOf(model.supportedCustomizations());
		for (String key : customizations.keySet()) {
			if (!supportedKeys.contains(key)) {
				throw new ValidationException("Unsupported customization: " + key);
			}
		}
		Object outfit = customizations.get("outfit");
		if (outfit != null
				&& (!(outfit instanceof String outfitId) || !model.outfitOptions().contains(outfitId))) {
			throw new ValidationException("Invalid outfit option");
		}
	}

	private void requireActiveUser(UUID authenticatedUserId) {
		if (userRepository.findByIdAndDeletedAtIsNull(authenticatedUserId).isEmpty()) {
			throw new UnauthorizedException(INVALID_SESSION_MESSAGE);
		}
	}

	private NotFoundException avatarNotFound() {
		return new NotFoundException(AVATAR_NOT_FOUND_MESSAGE);
	}

	public record UpsertResult(boolean created) {
	}
}
