package com.veiltalk.user;

import java.util.UUID;

import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RestController;

import jakarta.validation.Valid;

@RestController
public class UserProfileController {

	private final UserProfileService userProfileService;
	private final UserAccountService userAccountService;

	public UserProfileController(
			UserProfileService userProfileService,
			UserAccountService userAccountService) {
		this.userProfileService = userProfileService;
		this.userAccountService = userAccountService;
	}

	@GetMapping("/users/me")
	UserProfileResponse getProfile(Authentication authentication) {
		return userProfileService.getProfile((UUID) authentication.getPrincipal());
	}

	@PutMapping("/users/me")
	UserProfileResponse updateProfile(
			Authentication authentication,
			@Valid @RequestBody UserProfileUpdateRequest request) {
		return userProfileService.updateProfile(
				(UUID) authentication.getPrincipal(),
				request);
	}

	@GetMapping("/users/me/settings")
	UserSettingsResponse getSettings(Authentication authentication) {
		return userProfileService.getSettings((UUID) authentication.getPrincipal());
	}

	@PutMapping("/users/me/settings")
	UserSettingsResponse updateSettings(
			Authentication authentication,
			@Valid @RequestBody UserSettingsRequest request) {
		return userProfileService.updateSettings(
				(UUID) authentication.getPrincipal(),
				request);
	}

	@DeleteMapping("/users/me")
	@org.springframework.web.bind.annotation.ResponseStatus(org.springframework.http.HttpStatus.NO_CONTENT)
	void deleteAccount(
			Authentication authentication,
			@Valid @RequestBody DeleteAccountRequest request) {
		userAccountService.deleteAccount((UUID) authentication.getPrincipal(), request);
	}
}
