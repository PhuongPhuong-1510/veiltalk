package com.veiltalk.messaging;

import java.util.List;
import java.util.Map;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpStatus;
import org.springframework.http.server.ServerHttpRequest;
import org.springframework.http.server.ServerHttpResponse;
import org.springframework.stereotype.Component;
import org.springframework.web.socket.WebSocketHandler;
import org.springframework.web.socket.server.HandshakeInterceptor;
import org.springframework.web.util.UriComponentsBuilder;

import com.veiltalk.auth.JwtBlacklistService;
import com.veiltalk.auth.JwtClaims;
import com.veiltalk.auth.JwtService;
import com.veiltalk.auth.UserRepository;
import com.veiltalk.auth.UserTokenRevocationService;

@Component
public class WebSocketAuthHandshakeInterceptor implements HandshakeInterceptor {

	static final String USER_ID_ATTRIBUTE = "messaging.userId";
	static final String USER_ROLE_ATTRIBUTE = "messaging.userRole";
	static final String JWT_ID_ATTRIBUTE = "messaging.jwtId";
	static final String JWT_ISSUED_AT_ATTRIBUTE = "messaging.jwtIssuedAt";
	static final String JWT_EXPIRES_AT_ATTRIBUTE = "messaging.jwtExpiresAt";

	private static final Logger LOGGER = LoggerFactory.getLogger(WebSocketAuthHandshakeInterceptor.class);
	private static final String ACCESS_TOKEN_TYPE = "access";
	private static final String TOKEN_QUERY_PARAMETER = "token";

	private final JwtService jwtService;
	private final JwtBlacklistService jwtBlacklistService;
	private final UserTokenRevocationService userTokenRevocationService;
	private final UserRepository userRepository;

	public WebSocketAuthHandshakeInterceptor(
			JwtService jwtService,
			JwtBlacklistService jwtBlacklistService,
			UserTokenRevocationService userTokenRevocationService,
			UserRepository userRepository) {
		this.jwtService = jwtService;
		this.jwtBlacklistService = jwtBlacklistService;
		this.userTokenRevocationService = userTokenRevocationService;
		this.userRepository = userRepository;
	}

	@Override
	public boolean beforeHandshake(
			ServerHttpRequest request,
			ServerHttpResponse response,
			WebSocketHandler wsHandler,
			Map<String, Object> attributes) {
		String token = extractSingleToken(request);
		if (token == null) {
			return reject(response);
		}

		try {
			JwtClaims claims = jwtService.extractClaims(token);
			if (!isValidAccessClaims(claims)
					|| jwtBlacklistService.isBlacklisted(claims.jwtId())
					|| userTokenRevocationService.isRevoked(claims.subject(), claims.issuedAt())
					|| userRepository.findByIdAndDeletedAtIsNull(claims.subject()).isEmpty()) {
				return reject(response);
			}

			attributes.put(USER_ID_ATTRIBUTE, claims.subject());
			attributes.put(USER_ROLE_ATTRIBUTE, claims.role());
			attributes.put(JWT_ID_ATTRIBUTE, claims.jwtId());
			attributes.put(JWT_ISSUED_AT_ATTRIBUTE, claims.issuedAt());
			attributes.put(JWT_EXPIRES_AT_ATTRIBUTE, claims.expiresAt());
			return true;
		}
		catch (IllegalArgumentException exception) {
			return reject(response);
		}
		catch (RuntimeException exception) {
			LOGGER.error("Messaging WebSocket authentication check failed", exception);
			return reject(response);
		}
	}

	@Override
	public void afterHandshake(
			ServerHttpRequest request,
			ServerHttpResponse response,
			WebSocketHandler wsHandler,
			Exception exception) {
		// Không có tài nguyên nào cần dọn ở giai đoạn handshake.
	}

	private String extractSingleToken(ServerHttpRequest request) {
		List<String> tokens = UriComponentsBuilder.fromUri(request.getURI())
				.build()
				.getQueryParams()
				.get(TOKEN_QUERY_PARAMETER);
		if (tokens == null || tokens.size() != 1) {
			return null;
		}
		String token = tokens.getFirst();
		return token == null || token.isBlank() ? null : token;
	}

	private boolean isValidAccessClaims(JwtClaims claims) {
		return ACCESS_TOKEN_TYPE.equals(claims.type())
				&& claims.subject() != null
				&& claims.role() != null
				&& claims.jwtId() != null
				&& claims.issuedAt() != null
				&& claims.expiresAt() != null;
	}

	private boolean reject(ServerHttpResponse response) {
		response.setStatusCode(HttpStatus.UNAUTHORIZED);
		return false;
	}
}
