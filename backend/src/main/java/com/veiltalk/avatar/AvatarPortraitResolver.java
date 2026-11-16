package com.veiltalk.avatar;

import java.util.Collection;
import java.util.HashMap;
import java.util.Map;
import java.util.UUID;

import org.springframework.stereotype.Service;

import com.veiltalk.auth.User;

@Service
public class AvatarPortraitResolver {

	private static final String PORTRAIT_BASE_PATH = "/models/avatar-thumbnails/";

	private final AvatarProfileRepository avatarProfileRepository;

	public AvatarPortraitResolver(AvatarProfileRepository avatarProfileRepository) {
		this.avatarProfileRepository = avatarProfileRepository;
	}

	public String resolve(UUID userId, String explicitAvatarUrl) {
		if (explicitAvatarUrl != null && !explicitAvatarUrl.isBlank()) {
			return explicitAvatarUrl;
		}
		return avatarProfileRepository.findByUserId(userId)
				.map(profile -> portraitUrl(profile.getModelId()))
				.orElse(null);
	}

	public Map<UUID, String> resolveAll(Collection<User> users) {
		Map<UUID, String> portraits = new HashMap<>();
		var missingIds = users.stream()
				.filter(user -> user.getAvatarUrl() == null || user.getAvatarUrl().isBlank())
				.map(User::getId)
				.toList();
		for (User user : users) {
			if (user.getAvatarUrl() != null && !user.getAvatarUrl().isBlank()) {
				portraits.put(user.getId(), user.getAvatarUrl());
			}
		}
		if (!missingIds.isEmpty()) {
			avatarProfileRepository.findAllByUserIdIn(missingIds).forEach(profile ->
					portraits.put(profile.getUserId(), portraitUrl(profile.getModelId())));
		}
		return portraits;
	}

	public static String portraitUrl(String modelId) {
		return PORTRAIT_BASE_PATH + modelId + ".png";
	}

	public static String customPortraitUrl(UUID userId, UUID version) {
		return "/avatars/" + userId + "/portrait?v=" + version;
	}
}
