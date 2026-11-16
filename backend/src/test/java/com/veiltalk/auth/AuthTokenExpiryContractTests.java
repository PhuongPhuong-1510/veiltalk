package com.veiltalk.auth;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.BDDMockito.given;
import static org.mockito.Mockito.mock;

import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.Optional;
import java.util.UUID;

import org.junit.jupiter.api.Test;
import org.springframework.security.crypto.password.PasswordEncoder;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.veiltalk.avatar.AvatarProfileRepository;

import jakarta.persistence.EntityManager;

class AuthTokenExpiryContractTests {

	@Test
	void loginExpiresInMatchesTheConfiguredAccessTokenLifetime() {
		long configuredAccessLifetimeSeconds = 300;
		Clock clock = Clock.fixed(Instant.parse("2026-10-28T08:00:00Z"), ZoneOffset.UTC);
		JwtService jwtService = new JwtService(
				"test-only-secret-with-at-least-thirty-two-bytes",
				configuredAccessLifetimeSeconds,
				86_400,
				new ObjectMapper(),
				clock);
		UserRepository users = mock(UserRepository.class);
		RefreshTokenRepository refreshTokens = mock(RefreshTokenRepository.class);
		AvatarProfileRepository avatars = mock(AvatarProfileRepository.class);
		PasswordEncoder passwords = mock(PasswordEncoder.class);
		User user = new User();
		user.setId(UUID.randomUUID());
		user.setEmail("expiry-contract@example.test");
		user.setDisplayName("Expiry contract");
		user.setPasswordHash("stored-password-hash");

		given(users.findByEmailAndDeletedAtIsNull(user.getEmail())).willReturn(Optional.of(user));
		given(passwords.matches("correct-password", user.getPasswordHash())).willReturn(true);
		given(avatars.existsByUserId(user.getId())).willReturn(false);

		AuthService service = new AuthService(
				users,
				refreshTokens,
				avatars,
				jwtService,
				mock(JwtBlacklistService.class),
				passwords,
				mock(EntityManager.class),
				mock(UsernamePolicy.class));

		LoginResponse response = service.login(
				new LoginRequest(user.getEmail(), "correct-password"));
		JwtClaims accessClaims = jwtService.extractClaims(response.tokens().accessToken());
		long actualTokenLifetime = accessClaims.expiresAt().getEpochSecond()
				- accessClaims.issuedAt().getEpochSecond();

		assertThat(actualTokenLifetime).isEqualTo(configuredAccessLifetimeSeconds);
		assertThat(response.tokens().expiresIn()).isEqualTo(actualTokenLifetime);
	}
}
