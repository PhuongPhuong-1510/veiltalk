package com.veiltalk.user;

import java.util.UUID;

import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RestController;

import jakarta.validation.Valid;

@RestController
public class UserProfileController {

	private final UserProfileService userProfileService;

	public UserProfileController(UserProfileService userProfileService) {
		this.userProfileService = userProfileService;
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
}
