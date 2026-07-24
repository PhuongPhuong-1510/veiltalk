package com.veiltalk.auth;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

import java.time.Instant;
import java.util.UUID;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.mock.web.MockFilterChain;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;
import org.springframework.security.core.context.SecurityContextHolder;

@ExtendWith(MockitoExtension.class)
class JwtAuthenticationFilterTests {

	private static final UUID USER_ID = UUID.fromString("a310fc8c-109f-4e53-91ee-8fcd508f7512");
	private static final UUID JWT_ID = UUID.fromString("f135fa09-a49b-4278-9705-338d69132fcf");

	@Mock
	private JwtService jwtService;

	@Mock
	private JwtBlacklistService jwtBlacklistService;

	@AfterEach
	void clearSecurityContext() {
		SecurityContextHolder.clearContext();
	}

	@Test
	void validAccessTokenCreatesAuthenticationWithIdentityAndRole() throws Exception {
		JwtClaims claims = new JwtClaims(
				USER_ID,
				UserRole.ADMIN,
				"access",
				JWT_ID,
				Instant.parse("2026-07-24T12:00:00Z"),
				Instant.parse("2026-07-24T12:15:00Z"));
		when(jwtService.extractClaims("valid-token")).thenReturn(claims);
		MockHttpServletRequest request = requestWithAuthorization("Bearer valid-token");

		runFilter(request);

		var authentication = SecurityContextHolder.getContext().getAuthentication();
		assertThat(authentication).isNotNull();
		assertThat(authentication.getPrincipal()).isEqualTo(USER_ID);
		assertThat(authentication.getCredentials()).isEqualTo("valid-token");
		assertThat(authentication.getAuthorities())
				.extracting("authority")
				.containsExactly("ROLE_ADMIN");
	}

	@Test
	void blacklistedAccessTokenDoesNotCreateAuthentication() throws Exception {
		JwtClaims claims = new JwtClaims(
				USER_ID,
				UserRole.ADMIN,
				"access",
				JWT_ID,
				Instant.parse("2026-07-24T12:00:00Z"),
				Instant.parse("2026-07-24T12:15:00Z"));
		when(jwtService.extractClaims("revoked-token")).thenReturn(claims);
		when(jwtBlacklistService.isBlacklisted(JWT_ID)).thenReturn(true);

		runFilter(requestWithAuthorization("Bearer revoked-token"));

		assertThat(SecurityContextHolder.getContext().getAuthentication()).isNull();
	}

	@Test
	void refreshTokenDoesNotCreateAuthentication() throws Exception {
		JwtClaims claims = new JwtClaims(
				null,
				null,
				"refresh",
				JWT_ID,
				Instant.parse("2026-07-24T12:00:00Z"),
				Instant.parse("2026-07-31T12:00:00Z"));
		when(jwtService.extractClaims("refresh-token")).thenReturn(claims);

		runFilter(requestWithAuthorization("Bearer refresh-token"));

		assertThat(SecurityContextHolder.getContext().getAuthentication()).isNull();
	}

	@Test
	void invalidTokenContinuesWithoutAuthentication() throws Exception {
		when(jwtService.extractClaims("invalid-token"))
				.thenThrow(new IllegalArgumentException("Invalid JWT signature"));

		runFilter(requestWithAuthorization("Bearer invalid-token"));

		assertThat(SecurityContextHolder.getContext().getAuthentication()).isNull();
	}

	@Test
	void missingOrMalformedBearerHeaderDoesNotReadJwt() throws Exception {
		runFilter(new MockHttpServletRequest());
		runFilter(requestWithAuthorization("Basic credentials"));
		runFilter(requestWithAuthorization("Bearer   "));

		assertThat(SecurityContextHolder.getContext().getAuthentication()).isNull();
		verifyNoInteractions(jwtService);
	}

	private MockHttpServletRequest requestWithAuthorization(String value) {
		MockHttpServletRequest request = new MockHttpServletRequest();
		request.addHeader("Authorization", value);
		return request;
	}

	private void runFilter(MockHttpServletRequest request) throws Exception {
		var filter = new JwtAuthenticationFilter(jwtService, jwtBlacklistService);
		filter.doFilter(request, new MockHttpServletResponse(), new MockFilterChain());
	}
}
