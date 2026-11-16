package com.veiltalk.user;

import java.util.UUID;

import com.veiltalk.auth.TooManyRequestsException;

import org.springframework.security.core.Authentication;
import org.springframework.http.ResponseEntity;
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
	private final UserSearchService userSearchService;
	private final UsernameSearchService usernameSearchService;

	public UserProfileController(
			UserProfileService userProfileService,
			UserAccountService userAccountService,
			UserSearchService userSearchService,
			UsernameSearchService usernameSearchService) {
		this.userProfileService = userProfileService;
		this.userAccountService = userAccountService;
		this.userSearchService = userSearchService;
		this.usernameSearchService = usernameSearchService;
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

	@org.springframework.web.bind.annotation.PostMapping("/users/search")
	ResponseEntity<UserSearchResponse> searchUsers(
			Authentication authentication,
			@Valid @RequestBody UserSearchRequest request) {
		UserSearchService.SearchResult result = userSearchService.search(
				(UUID) authentication.getPrincipal(),
				request);
		if (!result.retryAfter().isZero()) {
			throw new TooManyRequestsException(result.retryAfter());
		}
		return ResponseEntity.ok(result.response());
	}

	@org.springframework.web.bind.annotation.PostMapping("/users/search/usernames")
	UsernameSearchResponse searchUsernames(
			Authentication authentication,
			@Valid @RequestBody UsernameSearchRequest request) {
		return usernameSearchService.search((UUID) authentication.getPrincipal(), request);
	}
}
