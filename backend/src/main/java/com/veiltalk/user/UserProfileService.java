package com.veiltalk.user;

import java.util.UUID;

import com.veiltalk.auth.UnauthorizedException;
import com.veiltalk.auth.User;
import com.veiltalk.auth.UserRepository;
import com.veiltalk.avatar.AvatarProfileRepository;

import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class UserProfileService {

	private static final String INVALID_SESSION_MESSAGE = "Invalid session";

	private final UserRepository userRepository;
	private final AvatarProfileRepository avatarProfileRepository;

	public UserProfileService(
			UserRepository userRepository,
			AvatarProfileRepository avatarProfileRepository) {
		this.userRepository = userRepository;
		this.avatarProfileRepository = avatarProfileRepository;
	}

	@Transactional(readOnly = true)
	public UserProfileResponse getProfile(UUID authenticatedUserId) {
		return toResponse(requireActiveUser(authenticatedUserId));
	}

	@Transactional
	public UserProfileResponse updateProfile(
			UUID authenticatedUserId,
			UserProfileUpdateRequest request) {
		User user = requireActiveUser(authenticatedUserId);
		if (request.isDisplayNameProvided()) {
			user.setDisplayName(request.getDisplayName());
		}
		if (request.isAvatarUrlProvided()) {
			user.setAvatarUrl(request.getAvatarUrl());
		}
		userRepository.saveAndFlush(user);
		return toResponse(user);
	}

	private User requireActiveUser(UUID authenticatedUserId) {
		return userRepository.findByIdAndDeletedAtIsNull(authenticatedUserId)
				.orElseThrow(() -> new UnauthorizedException(INVALID_SESSION_MESSAGE));
	}

	private UserProfileResponse toResponse(User user) {
		return new UserProfileResponse(
				user.getId(),
				user.getEmail(),
				user.getDisplayName(),
				user.getAvatarUrl(),
				user.getRole().getDatabaseValue(),
				avatarProfileRepository.existsByUserId(user.getId()),
				user.getCreatedAt());
	}
}
