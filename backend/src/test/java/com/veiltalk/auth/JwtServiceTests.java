package com.veiltalk.auth;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.UUID;

import org.junit.jupiter.api.Test;

import com.fasterxml.jackson.databind.ObjectMapper;

class JwtServiceTests {

	private static final String SECRET = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
	private static final Instant NOW = Instant.parse("2026-07-24T12:00:00Z");
	private static final UUID USER_ID = UUID.fromString("a310fc8c-109f-4e53-91ee-8fcd508f7512");

	private final ObjectMapper objectMapper = new ObjectMapper();
	private final Clock clock = Clock.fixed(NOW, ZoneOffset.UTC);
	private final JwtService jwtService = new JwtService(SECRET, 900, 604800, objectMapper, clock);

	@Test
	void generateAccessTokenIncludesIdentityRoleAndFifteenMinuteExpiry() {
		String token = jwtService.generateAccessToken(USER_ID, UserRole.ADMIN);

		JwtClaims claims = jwtService.extractClaims(token);

		assertThat(claims.subject()).isEqualTo(USER_ID);
		assertThat(claims.role()).isEqualTo(UserRole.ADMIN);
		assertThat(claims.type()).isEqualTo("access");
		assertThat(claims.jwtId()).isNotNull();
		assertThat(claims.issuedAt()).isEqualTo(NOW);
		assertThat(claims.expiresAt()).isEqualTo(NOW.plusSeconds(900));
	}

	@Test
	void generateRefreshTokenIncludesSevenDayExpiryWithoutAccessClaims() {
		String token = jwtService.generateRefreshToken();

		JwtClaims claims = jwtService.extractClaims(token);

		assertThat(claims.subject()).isNull();
		assertThat(claims.role()).isNull();
		assertThat(claims.type()).isEqualTo("refresh");
		assertThat(claims.jwtId()).isNotNull();
		assertThat(claims.issuedAt()).isEqualTo(NOW);
		assertThat(claims.expiresAt()).isEqualTo(NOW.plusSeconds(604800));
	}

	@Test
	void generatedTokensUseDifferentJwtIds() {
		JwtClaims first = jwtService.extractClaims(jwtService.generateRefreshToken());
		JwtClaims second = jwtService.extractClaims(jwtService.generateRefreshToken());

		assertThat(first.jwtId()).isNotEqualTo(second.jwtId());
	}

	@Test
	void typeSpecificValidationDoesNotAcceptRefreshTokenAsAccessToken() {
		String accessToken = jwtService.generateAccessToken(USER_ID, UserRole.USER);
		String refreshToken = jwtService.generateRefreshToken();

		assertThat(jwtService.validateAccessToken(accessToken)).isTrue();
		assertThat(jwtService.validateAccessToken(refreshToken)).isFalse();
		assertThat(jwtService.validateRefreshToken(refreshToken)).isTrue();
		assertThat(jwtService.validateRefreshToken(accessToken)).isFalse();
	}

	@Test
	void validateTokenRejectsExpiredToken() {
		String token = jwtService.generateAccessToken(USER_ID, UserRole.USER);
		JwtService laterService = new JwtService(
				SECRET,
				900,
				604800,
				objectMapper,
				Clock.fixed(NOW.plusSeconds(901), ZoneOffset.UTC));

		assertThat(laterService.validateToken(token)).isFalse();
		assertThatThrownBy(() -> laterService.extractClaims(token))
				.isInstanceOf(IllegalArgumentException.class);
	}

	@Test
	void validateTokenRejectsTokenSignedWithDifferentSecret() {
		String token = jwtService.generateAccessToken(USER_ID, UserRole.USER);
		JwtService otherService = new JwtService(
				"abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789",
				900,
				604800,
				objectMapper,
				clock);

		assertThat(otherService.validateToken(token)).isFalse();
	}

	@Test
	void validateTokenRejectsMalformedValues() {
		assertThat(jwtService.validateToken(null)).isFalse();
		assertThat(jwtService.validateToken("")).isFalse();
		assertThat(jwtService.validateToken("not-a-jwt")).isFalse();
		assertThat(jwtService.validateToken("a.b.c")).isFalse();
	}

	@Test
	void constructorRejectsInvalidConfiguration() {
		assertThatThrownBy(() -> new JwtService("", 900, 604800, objectMapper, clock))
				.isInstanceOf(IllegalArgumentException.class);
		assertThatThrownBy(() -> new JwtService("too-short", 900, 604800, objectMapper, clock))
				.isInstanceOf(IllegalArgumentException.class);
		assertThatThrownBy(() -> new JwtService(SECRET, 0, 604800, objectMapper, clock))
				.isInstanceOf(IllegalArgumentException.class);
		assertThatThrownBy(() -> new JwtService(SECRET, 900, -1, objectMapper, clock))
				.isInstanceOf(IllegalArgumentException.class);
	}
}
