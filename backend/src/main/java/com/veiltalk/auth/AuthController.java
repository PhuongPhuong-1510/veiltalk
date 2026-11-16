package com.veiltalk.auth;

import org.springframework.http.HttpStatus;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

import jakarta.validation.Valid;
import jakarta.servlet.http.HttpServletRequest;

@RestController
public class AuthController {

	private final AuthService authService;
	private final AuthAbuseRateLimiter abuseRateLimiter;
	private final AuthClientIpResolver ipResolver;

	public AuthController(AuthService authService, AuthAbuseRateLimiter abuseRateLimiter,
			AuthClientIpResolver ipResolver) {
		this.authService = authService;
		this.abuseRateLimiter = abuseRateLimiter;
		this.ipResolver = ipResolver;
	}

	@PostMapping("/auth/register")
	@ResponseStatus(HttpStatus.CREATED)
	RegisterResponse register(@Valid @RequestBody RegisterRequest request, HttpServletRequest httpRequest) {
		String ip = ipResolver.resolve(httpRequest);
		abuseRateLimiter.reserveRegistration(ip);
		try {
			return authService.register(request);
		} catch (RuntimeException exception) {
			abuseRateLimiter.releaseRegistration(ip);
			throw exception;
		}
	}

	@PostMapping("/auth/login")
	LoginResponse login(@Valid @RequestBody LoginRequest request, HttpServletRequest httpRequest) {
		String ip = ipResolver.resolve(httpRequest);
		abuseRateLimiter.checkLogin(request.email(), ip);
		try {
			return authService.login(request);
		} catch (UnauthorizedException exception) {
			abuseRateLimiter.recordLoginPairFailure(request.email(), ip);
			throw exception;
		}
	}

	@PostMapping("/auth/refresh")
	RefreshResponse refresh(@Valid @RequestBody RefreshTokenRequest request) {
		return authService.refresh(request);
	}

	@PostMapping("/auth/logout")
	@ResponseStatus(HttpStatus.NO_CONTENT)
	void logout(
			Authentication authentication,
			@Valid @RequestBody RefreshTokenRequest request) {
		authService.logout(
				(java.util.UUID) authentication.getPrincipal(),
				(String) authentication.getCredentials(),
				request);
	}
}
