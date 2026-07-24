package com.veiltalk.auth;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.HexFormat;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.TimeUnit;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.http.MediaType;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;
import org.springframework.transaction.annotation.Transactional;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.jayway.jsonpath.JsonPath;

@SpringBootTest
@AutoConfigureMockMvc
@Transactional
class AuthRefreshLogoutIntegrationTests {

	private static final String EMAIL = "refresh@example.com";
	private static final String PASSWORD = "Secure123";

	@Autowired
	private MockMvc mockMvc;

	@Autowired
	private UserRepository userRepository;

	@Autowired
	private RefreshTokenRepository refreshTokenRepository;

	@Autowired
	private PasswordEncoder passwordEncoder;

	@Autowired
	private JwtService jwtService;

	@Autowired
	private JwtBlacklistService jwtBlacklistService;

	@Autowired
	private StringRedisTemplate redisTemplate;

	@Autowired
	private ObjectMapper objectMapper;

	@Value("${jwt.secret}")
	private String jwtSecret;

	private final List<UUID> blacklistKeysToDelete = new ArrayList<>();

	@BeforeEach
	void createActiveUser() {
		createUser(EMAIL);
	}

	@AfterEach
	void clearBlacklistKeys() {
		blacklistKeysToDelete.forEach(jwtId -> redisTemplate.delete(jwtBlacklistService.key(jwtId)));
	}

	@Test
	void tc07IssuesNewAccessTokenForActiveStoredRefreshToken() throws Exception {
		Tokens tokens = login(EMAIL, PASSWORD);

		mockMvc.perform(refreshRequest(tokens.refreshToken()))
				.andExpect(status().isOk())
				.andExpect(jsonPath("$.access_token").isNotEmpty())
				.andExpect(jsonPath("$.access_token").value(
						org.hamcrest.Matchers.not(tokens.accessToken())))
				.andExpect(jsonPath("$.expires_in").value(900));
	}

	@Test
	void tc08RejectsExpiredRefreshToken() throws Exception {
		Clock oldClock = Clock.fixed(Instant.parse("2020-01-01T00:00:00Z"), ZoneOffset.UTC);
		JwtService oldJwtService = new JwtService(jwtSecret, 900, 604800, objectMapper, oldClock);
		String expiredRefreshToken = oldJwtService.generateRefreshToken();

		mockMvc.perform(refreshRequest(expiredRefreshToken))
				.andExpect(status().isUnauthorized())
				.andExpect(jsonPath("$.error.code").value("UNAUTHORIZED"));
	}

	@Test
	void tc09RevokesRefreshTokenAndBlacklistsCurrentAccessToken() throws Exception {
		Tokens tokens = login(EMAIL, PASSWORD);
		JwtClaims accessClaims = jwtService.extractClaims(tokens.accessToken());
		blacklistKeysToDelete.add(accessClaims.jwtId());

		mockMvc.perform(post("/auth/logout")
						.header("Authorization", "Bearer " + tokens.accessToken())
						.contentType(MediaType.APPLICATION_JSON)
						.content(refreshBody(tokens.refreshToken())))
				.andExpect(status().isNoContent());

		RefreshToken storedToken = refreshTokenRepository
				.findByTokenHash(hash(tokens.refreshToken()))
				.orElseThrow();
		assertThat(storedToken.getRevokedAt()).isNotNull();
		assertThat(jwtBlacklistService.isBlacklisted(accessClaims.jwtId())).isTrue();
		Long blacklistTtl = redisTemplate.getExpire(
				jwtBlacklistService.key(accessClaims.jwtId()),
				TimeUnit.SECONDS);
		assertThat(blacklistTtl).isPositive().isLessThanOrEqualTo(900);

		mockMvc.perform(refreshRequest(tokens.refreshToken()))
				.andExpect(status().isUnauthorized());
		mockMvc.perform(get("/protected")
						.header("Authorization", "Bearer " + tokens.accessToken()))
				.andExpect(status().isUnauthorized());
	}

	@Test
	void logoutRejectsRefreshTokenOwnedByAnotherUser() throws Exception {
		createUser("other@example.com");
		Tokens firstUserTokens = login(EMAIL, PASSWORD);
		Tokens otherUserTokens = login("other@example.com", PASSWORD);

		mockMvc.perform(post("/auth/logout")
						.header("Authorization", "Bearer " + firstUserTokens.accessToken())
						.contentType(MediaType.APPLICATION_JSON)
						.content(refreshBody(otherUserTokens.refreshToken())))
				.andExpect(status().isUnauthorized());

		assertThat(refreshTokenRepository.findByTokenHash(hash(firstUserTokens.refreshToken())).orElseThrow()
				.getRevokedAt()).isNull();
		assertThat(refreshTokenRepository.findByTokenHash(hash(otherUserTokens.refreshToken())).orElseThrow()
				.getRevokedAt()).isNull();
	}

	@Test
	void refreshRejectsTokenWhenOwnerWasSoftDeleted() throws Exception {
		Tokens tokens = login(EMAIL, PASSWORD);
		User user = userRepository.findByEmailAndDeletedAtIsNull(EMAIL).orElseThrow();
		user.setDeletedAt(Instant.now());
		userRepository.saveAndFlush(user);

		mockMvc.perform(refreshRequest(tokens.refreshToken()))
				.andExpect(status().isUnauthorized());
	}

	private User createUser(String email) {
		User user = new User();
		user.setEmail(email);
		user.setPasswordHash(passwordEncoder.encode(PASSWORD));
		user.setDisplayName("Refresh user");
		return userRepository.saveAndFlush(user);
	}

	private Tokens login(String email, String password) throws Exception {
		String body = """
				{
				  "email": "%s",
				  "password": "%s"
				}
				""".formatted(email, password);
		MvcResult result = mockMvc.perform(post("/auth/login")
						.contentType(MediaType.APPLICATION_JSON)
						.content(body))
				.andExpect(status().isOk())
				.andReturn();
		return new Tokens(
				JsonPath.read(result.getResponse().getContentAsString(), "$.tokens.access_token"),
				JsonPath.read(result.getResponse().getContentAsString(), "$.tokens.refresh_token"));
	}

	private org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder refreshRequest(
			String refreshToken) {
		return post("/auth/refresh")
				.contentType(MediaType.APPLICATION_JSON)
				.content(refreshBody(refreshToken));
	}

	private String refreshBody(String refreshToken) {
		return """
				{
				  "refresh_token": "%s"
				}
				""".formatted(refreshToken);
	}

	private String hash(String refreshToken) {
		try {
			return HexFormat.of().formatHex(
					MessageDigest.getInstance("SHA-256")
							.digest(refreshToken.getBytes(StandardCharsets.UTF_8)));
		}
		catch (NoSuchAlgorithmException exception) {
			throw new IllegalStateException(exception);
		}
	}

	private record Tokens(String accessToken, String refreshToken) {
	}
}
