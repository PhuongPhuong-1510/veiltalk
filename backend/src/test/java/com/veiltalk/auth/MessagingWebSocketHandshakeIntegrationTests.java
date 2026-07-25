package com.veiltalk.auth;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.fail;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.WebSocket;
import java.net.http.WebSocketHandshakeException;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.UUID;
import java.util.concurrent.CompletionException;
import java.util.concurrent.TimeUnit;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.data.redis.core.StringRedisTemplate;

import com.fasterxml.jackson.databind.ObjectMapper;

@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
class MessagingWebSocketHandshakeIntegrationTests {

	@LocalServerPort
	private int port;

	@Autowired
	private JwtService jwtService;

	@Autowired
	private JwtBlacklistService jwtBlacklistService;

	@Autowired
	private UserTokenRevocationService userTokenRevocationService;

	@Autowired
	private UserRepository userRepository;

	@Autowired
	private StringRedisTemplate redisTemplate;

	@Autowired
	private ObjectMapper objectMapper;

	@Value("${jwt.secret}")
	private String jwtSecret;

	private User user;

	@BeforeEach
	void createUser() {
		User newUser = new User();
		newUser.setEmail("messaging-ws-handshake-" + UUID.randomUUID() + "@example.com");
		newUser.setPasswordHash("not-used-by-handshake");
		newUser.setDisplayName("Messaging WS handshake");
		user = userRepository.saveAndFlush(newUser);
	}

	@AfterEach
	void cleanUp() {
		if (user != null) {
			redisTemplate.delete("jwt:user-revoked-after:" + user.getId());
			userRepository.deleteById(user.getId());
			userRepository.flush();
		}
	}

	@Test
	void validAccessTokenCompletesWebSocketUpgrade() {
		WebSocket webSocket = connect(jwtService.generateAccessToken(user.getId(), user.getRole()));

		assertThat(webSocket.isOutputClosed()).isFalse();
		webSocket.sendClose(WebSocket.NORMAL_CLOSURE, "test complete").join();
	}

	@Test
	void tc47MissingMalformedExpiredAndRefreshTokensAreRejectedWith401() {
		assertUnauthorized(null);
		assertUnauthorized("invalid-token");
		assertUnauthorized(expiredAccessToken());
		assertUnauthorized(jwtService.generateRefreshToken());
	}

	@Test
	void tc47BlacklistedAndGloballyRevokedTokensAreRejectedWith401() {
		String blacklistedToken = jwtService.generateAccessToken(user.getId(), user.getRole());
		JwtClaims blacklistedClaims = jwtService.extractClaims(blacklistedToken);
		jwtBlacklistService.blacklist(blacklistedClaims.jwtId(), Duration.ofMinutes(1));
		try {
			assertUnauthorized(blacklistedToken);
		}
		finally {
			redisTemplate.delete("jwt:blacklist:" + blacklistedClaims.jwtId());
		}

		String revokedToken = jwtService.generateAccessToken(user.getId(), user.getRole());
		userTokenRevocationService.revokeAllIssuedTokens(user.getId(), Instant.now());
		assertUnauthorized(revokedToken);
	}

	@Test
	void tc47SoftDeletedUserTokenIsRejectedWith401() {
		String token = jwtService.generateAccessToken(user.getId(), user.getRole());
		user.setDeletedAt(Instant.now());
		userRepository.saveAndFlush(user);

		assertUnauthorized(token);
	}

	private String expiredAccessToken() {
		Clock oldClock = Clock.fixed(Instant.parse("2020-01-01T00:00:00Z"), ZoneOffset.UTC);
		JwtService oldJwtService = new JwtService(jwtSecret, 900, 604800, objectMapper, oldClock);
		return oldJwtService.generateAccessToken(user.getId(), user.getRole());
	}

	private void assertUnauthorized(String token) {
		try {
			connect(token);
			fail("Expected WebSocket handshake to be rejected");
		}
		catch (CompletionException exception) {
			WebSocketHandshakeException handshakeException = findHandshakeException(exception);
			assertThat(handshakeException.getResponse().statusCode()).isEqualTo(401);
		}
	}

	private WebSocket connect(String token) {
		String query = token == null ? "" : "?token=" + token;
		return HttpClient.newHttpClient()
				.newWebSocketBuilder()
				.buildAsync(
						URI.create("ws://localhost:" + port + "/ws/messaging" + query),
						new WebSocket.Listener() {
						})
				.orTimeout(5, TimeUnit.SECONDS)
				.join();
	}

	private WebSocketHandshakeException findHandshakeException(Throwable throwable) {
		Throwable current = throwable;
		while (current != null) {
			if (current instanceof WebSocketHandshakeException handshakeException) {
				return handshakeException;
			}
			current = current.getCause();
		}
		throw new AssertionError("Expected WebSocketHandshakeException", throwable);
	}
}
