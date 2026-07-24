package com.veiltalk.user;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.ArrayList;
import java.util.HexFormat;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.TimeUnit;

import com.jayway.jsonpath.JsonPath;
import com.veiltalk.auth.RefreshToken;
import com.veiltalk.auth.RefreshTokenRepository;
import com.veiltalk.auth.User;
import com.veiltalk.auth.UserRepository;
import com.veiltalk.auth.UserTokenRevocationService;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.http.MediaType;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;
import org.springframework.transaction.annotation.Transactional;

@SpringBootTest
@AutoConfigureMockMvc
@Transactional
class UserAccountDeletionIntegrationTests {

	private static final String EMAIL = "delete-account@example.com";
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
	private UserTokenRevocationService userTokenRevocationService;

	@Autowired
	private StringRedisTemplate redisTemplate;

	private final List<UUID> revocationKeysToDelete = new ArrayList<>();
	private User user;

	@BeforeEach
	void createActiveUser() {
		user = new User();
		user.setEmail(EMAIL);
		user.setPasswordHash(passwordEncoder.encode(PASSWORD));
		user.setDisplayName("Delete account");
		user = userRepository.saveAndFlush(user);
		revocationKeysToDelete.add(user.getId());
	}

	@AfterEach
	void clearRedisKeys() {
		revocationKeysToDelete.forEach(
				userId -> redisTemplate.delete(revocationKey(userId)));
	}

	@Test
	void deletesAccountAndGloballyRevokesAllTokens() throws Exception {
		Tokens firstSession = login();
		Tokens secondSession = login();

		mockMvc.perform(delete("/users/me")
						.header("Authorization", "Bearer " + firstSession.accessToken())
						.contentType(MediaType.APPLICATION_JSON)
						.content(passwordBody(PASSWORD)))
				.andExpect(status().isNoContent());

		assertThat(userRepository.findByIdAndDeletedAtIsNull(user.getId())).isEmpty();
		assertThat(userRepository.findById(user.getId()).orElseThrow().getDeletedAt()).isNotNull();
		assertRefreshTokenRevoked(firstSession.refreshToken());
		assertRefreshTokenRevoked(secondSession.refreshToken());

		String revocationKey = revocationKey(user.getId());
		assertThat(redisTemplate.opsForValue().get(revocationKey)).isNotBlank();
		Long ttl = redisTemplate.getExpire(revocationKey, TimeUnit.SECONDS);
		assertThat(ttl).isPositive().isLessThanOrEqualTo(900);

		mockMvc.perform(get("/protected")
						.header("Authorization", "Bearer " + firstSession.accessToken()))
				.andExpect(status().isUnauthorized());
		mockMvc.perform(get("/protected")
						.header("Authorization", "Bearer " + secondSession.accessToken()))
				.andExpect(status().isUnauthorized());
		mockMvc.perform(post("/auth/refresh")
						.contentType(MediaType.APPLICATION_JSON)
						.content(refreshBody(firstSession.refreshToken())))
				.andExpect(status().isUnauthorized());
	}

	@Test
	void rejectsWrongPasswordWithoutChangingAccountOrTokens() throws Exception {
		Tokens tokens = login();

		mockMvc.perform(delete("/users/me")
						.header("Authorization", "Bearer " + tokens.accessToken())
						.contentType(MediaType.APPLICATION_JSON)
						.content(passwordBody("WrongPass123")))
				.andExpect(status().isUnauthorized())
				.andExpect(jsonPath("$.error.code").value("UNAUTHORIZED"));

		assertThat(userRepository.findByIdAndDeletedAtIsNull(user.getId())).isPresent();
		assertThat(refreshToken(tokens.refreshToken()).getRevokedAt()).isNull();
		assertThat(redisTemplate.hasKey(revocationKey(user.getId()))).isFalse();
	}

	@Test
	void rejectsMissingPassword() throws Exception {
		Tokens tokens = login();

		mockMvc.perform(delete("/users/me")
						.header("Authorization", "Bearer " + tokens.accessToken())
						.contentType(MediaType.APPLICATION_JSON)
						.content("{}"))
				.andExpect(status().isBadRequest())
				.andExpect(jsonPath("$.error.code").value("VALIDATION_ERROR"));
	}

	@Test
	void rejectsRequestWithoutAuthentication() throws Exception {
		mockMvc.perform(delete("/users/me")
						.contentType(MediaType.APPLICATION_JSON)
						.content(passwordBody(PASSWORD)))
				.andExpect(status().isUnauthorized());
	}

	private Tokens login() throws Exception {
		MvcResult result = mockMvc.perform(post("/auth/login")
						.contentType(MediaType.APPLICATION_JSON)
						.content("""
								{
								  "email": "%s",
								  "password": "%s"
								}
								""".formatted(EMAIL, PASSWORD)))
				.andExpect(status().isOk())
				.andReturn();
		return new Tokens(
				JsonPath.read(result.getResponse().getContentAsString(), "$.tokens.access_token"),
				JsonPath.read(result.getResponse().getContentAsString(), "$.tokens.refresh_token"));
	}

	private void assertRefreshTokenRevoked(String rawToken) throws Exception {
		assertThat(refreshToken(rawToken).getRevokedAt()).isNotNull();
	}

	private RefreshToken refreshToken(String rawToken) throws Exception {
		String hash = HexFormat.of().formatHex(
				MessageDigest.getInstance("SHA-256")
						.digest(rawToken.getBytes(StandardCharsets.UTF_8)));
		return refreshTokenRepository.findByTokenHash(hash).orElseThrow();
	}

	private String passwordBody(String password) {
		return """
				{ "password": "%s" }
				""".formatted(password);
	}

	private String refreshBody(String refreshToken) {
		return """
				{ "refresh_token": "%s" }
				""".formatted(refreshToken);
	}

	private String revocationKey(UUID userId) {
		return "jwt:user-revoked-after:" + userId;
	}

	private record Tokens(String accessToken, String refreshToken) {
	}
}
