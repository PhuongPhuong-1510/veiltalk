package com.veiltalk.user;

import java.util.UUID;

import com.veiltalk.auth.UnauthorizedException;
import com.veiltalk.auth.User;
import com.veiltalk.auth.UserRepository;
import com.veiltalk.auth.ValidationException;
import com.veiltalk.avatar.AvatarProfileRepository;
import com.veiltalk.avatar.AvatarPortraitResolver;

import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class UserProfileService {

	private static final String INVALID_SESSION_MESSAGE = "Invalid session";

	private final UserRepository userRepository;
	private final AvatarProfileRepository avatarProfileRepository;
	private final AvatarPortraitResolver avatarPortraitResolver;

	public UserProfileService(
			UserRepository userRepository,
			AvatarProfileRepository avatarProfileRepository,
			AvatarPortraitResolver avatarPortraitResolver) {
		this.userRepository = userRepository;
		this.avatarProfileRepository = avatarProfileRepository;
		this.avatarPortraitResolver = avatarPortraitResolver;
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
		if (request.isAvatarUrlProvided()) {
			throw new ValidationException("avatar_url is managed by the avatar editor");
		}
		if (request.isDisplayNameProvided()) {
			user.setDisplayName(request.getDisplayName());
		}
		userRepository.saveAndFlush(user);
		return toResponse(user);
	}

	@Transactional(readOnly = true)
	public UserSettingsResponse getSettings(UUID authenticatedUserId) {
		return toSettingsResponse(requireActiveUser(authenticatedUserId));
	}

	@Transactional
	public UserSettingsResponse updateSettings(
			UUID authenticatedUserId,
			UserSettingsRequest request) {
		User user = requireActiveUser(authenticatedUserId);
		if (request.getDiscoverable() != null) {
			user.setDiscoverable(request.getDiscoverable());
		}
		if (request.getUsernameSearchable() != null) {
			if (request.getUsernameSearchable() && user.getUsername() == null) {
				throw new UsernameRequiredException();
			}
			user.setUsernameSearchable(request.getUsernameSearchable());
		}
		if (request.getEmailNotifications() != null) {
			user.setEmailNotifications(request.getEmailNotifications());
		}
		if (request.isThemeProvided()) {
			user.setTheme(Theme.fromDatabaseValue(request.getTheme()));
		}
		userRepository.saveAndFlush(user);
		return toSettingsResponse(user);
	}

	private User requireActiveUser(UUID authenticatedUserId) {
		return userRepository.findByIdAndDeletedAtIsNull(authenticatedUserId)
				.orElseThrow(() -> new UnauthorizedException(INVALID_SESSION_MESSAGE));
	}

	private UserProfileResponse toResponse(User user) {
		return new UserProfileResponse(
				user.getId(),
				user.getEmail(),
				user.getUsername(),
				user.getDisplayName(),
				avatarPortraitResolver.resolve(user.getId(), user.getAvatarUrl()),
				user.getRole().getDatabaseValue(),
				avatarProfileRepository.existsByUserId(user.getId()),
				user.getCreatedAt());
	}

	private UserSettingsResponse toSettingsResponse(User user) {
		return new UserSettingsResponse(
				user.isDiscoverable(),
				user.isUsernameSearchable(),
				user.isEmailNotifications(),
				user.getTheme().getDatabaseValue());
	}
}
