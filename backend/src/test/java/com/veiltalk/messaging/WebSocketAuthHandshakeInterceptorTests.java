package com.veiltalk.messaging;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import java.time.Instant;
import java.util.HashMap;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.http.HttpStatus;
import org.springframework.http.server.ServerHttpRequest;
import org.springframework.http.server.ServletServerHttpRequest;
import org.springframework.http.server.ServletServerHttpResponse;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;
import org.springframework.web.socket.WebSocketHandler;

import com.veiltalk.auth.JwtBlacklistService;
import com.veiltalk.auth.JwtClaims;
import com.veiltalk.auth.JwtService;
import com.veiltalk.auth.User;
import com.veiltalk.auth.UserRepository;
import com.veiltalk.auth.UserRole;
import com.veiltalk.auth.UserTokenRevocationService;

@ExtendWith(MockitoExtension.class)
class WebSocketAuthHandshakeInterceptorTests {

	private static final UUID USER_ID = UUID.fromString("a310fc8c-109f-4e53-91ee-8fcd508f7512");
	private static final UUID JWT_ID = UUID.fromString("f135fa09-a49b-4278-9705-338d69132fcf");
	private static final Instant ISSUED_AT = Instant.parse("2026-07-24T12:00:00Z");
	private static final Instant EXPIRES_AT = Instant.parse("2026-07-24T12:15:00Z");

	@Mock
	private JwtService jwtService;

	@Mock
	private JwtBlacklistService jwtBlacklistService;

	@Mock
	private UserTokenRevocationService userTokenRevocationService;

	@Mock
	private UserRepository userRepository;

	@Mock
	private WebSocketHandler webSocketHandler;

	private WebSocketAuthHandshakeInterceptor interceptor;

	@BeforeEach
	void setUp() {
		interceptor = new WebSocketAuthHandshakeInterceptor(
				jwtService,
				jwtBlacklistService,
				userTokenRevocationService,
				userRepository);
	}

	@Test
	void validActiveUserAccessTokenStoresClaimsInHandshakeAttributes() {
		JwtClaims claims = accessClaims();
		when(jwtService.extractClaims("valid-token")).thenReturn(claims);
		when(userRepository.findByIdAndDeletedAtIsNull(USER_ID)).thenReturn(Optional.of(new User()));
		Map<String, Object> attributes = new HashMap<>();
		MockHttpServletResponse servletResponse = new MockHttpServletResponse();

		boolean accepted = interceptor.beforeHandshake(
				request("?token=valid-token"),
				new ServletServerHttpResponse(servletResponse),
				webSocketHandler,
				attributes);

		assertThat(accepted).isTrue();
		assertThat(servletResponse.getStatus()).isEqualTo(HttpStatus.OK.value());
		assertThat(attributes)
				.containsEntry(WebSocketAuthHandshakeInterceptor.USER_ID_ATTRIBUTE, USER_ID)
				.containsEntry(WebSocketAuthHandshakeInterceptor.USER_ROLE_ATTRIBUTE, UserRole.USER)
				.containsEntry(WebSocketAuthHandshakeInterceptor.JWT_ID_ATTRIBUTE, JWT_ID)
				.containsEntry(WebSocketAuthHandshakeInterceptor.JWT_ISSUED_AT_ATTRIBUTE, ISSUED_AT)
				.containsEntry(WebSocketAuthHandshakeInterceptor.JWT_EXPIRES_AT_ATTRIBUTE, EXPIRES_AT);
	}

	@Test
	void missingBlankOrDuplicateTokenIsRejectedBeforeJwtValidation() {
		assertRejected("");
		assertRejected("?token=");
		assertRejected("?token=first&token=second");

		verify(jwtService, never()).extractClaims(any());
	}

	@Test
	void invalidExpiredOrRefreshTokenIsRejected() {
		when(jwtService.extractClaims("invalid-token"))
				.thenThrow(new IllegalArgumentException("Invalid signature"));
		when(jwtService.extractClaims("expired-token"))
				.thenThrow(new IllegalArgumentException("JWT has expired"));
		when(jwtService.extractClaims("refresh-token")).thenReturn(refreshClaims());

		assertRejected("?token=invalid-token");
		assertRejected("?token=expired-token");
		assertRejected("?token=refresh-token");

		verify(userRepository, never()).findByIdAndDeletedAtIsNull(any());
	}

	@Test
	void blacklistedGloballyRevokedOrDeletedUserTokenIsRejected() {
		JwtClaims claims = accessClaims();
		when(jwtService.extractClaims("blacklisted-token")).thenReturn(claims);
		when(jwtBlacklistService.isBlacklisted(JWT_ID)).thenReturn(true);
		assertRejected("?token=blacklisted-token");

		when(jwtService.extractClaims("revoked-token")).thenReturn(claims);
		when(jwtBlacklistService.isBlacklisted(JWT_ID)).thenReturn(false);
		when(userTokenRevocationService.isRevoked(USER_ID, ISSUED_AT)).thenReturn(true);
		assertRejected("?token=revoked-token");

		when(jwtService.extractClaims("deleted-user-token")).thenReturn(claims);
		when(userTokenRevocationService.isRevoked(USER_ID, ISSUED_AT)).thenReturn(false);
		when(userRepository.findByIdAndDeletedAtIsNull(USER_ID)).thenReturn(Optional.empty());
		assertRejected("?token=deleted-user-token");
	}

	@Test
	void authenticationDependencyFailureFailsClosed() {
		when(jwtService.extractClaims("valid-token")).thenReturn(accessClaims());
		when(jwtBlacklistService.isBlacklisted(JWT_ID))
				.thenThrow(new IllegalStateException("Redis unavailable"));

		assertRejected("?token=valid-token");
	}

	private void assertRejected(String query) {
		MockHttpServletResponse servletResponse = new MockHttpServletResponse();

		boolean accepted = interceptor.beforeHandshake(
				request(query),
				new ServletServerHttpResponse(servletResponse),
				webSocketHandler,
				new HashMap<>());

		assertThat(accepted).isFalse();
		assertThat(servletResponse.getStatus()).isEqualTo(HttpStatus.UNAUTHORIZED.value());
	}

	private ServerHttpRequest request(String query) {
		MockHttpServletRequest request = new MockHttpServletRequest("GET", "/ws/messaging");
		request.setScheme("http");
		request.setServerName("localhost");
		request.setServerPort(80);
		if (!query.isEmpty()) {
			request.setQueryString(query.substring(1));
		}
		return new ServletServerHttpRequest(request);
	}

	private JwtClaims accessClaims() {
		return new JwtClaims(USER_ID, UserRole.USER, "access", JWT_ID, ISSUED_AT, EXPIRES_AT);
	}

	private JwtClaims refreshClaims() {
		return new JwtClaims(null, null, "refresh", JWT_ID, ISSUED_AT, EXPIRES_AT);
	}
}
