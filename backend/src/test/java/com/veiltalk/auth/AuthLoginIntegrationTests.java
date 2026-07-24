package com.veiltalk.auth;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.time.Instant;
import java.util.HexFormat;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;
import org.springframework.transaction.annotation.Transactional;

@SpringBootTest
@AutoConfigureMockMvc
@Transactional
class AuthLoginIntegrationTests {

	private static final String EMAIL = "login@example.com";
	private static final String PASSWORD = "Secure123";

	@Autowired
	private MockMvc mockMvc;

	@Autowired
	private UserRepository userRepository;

	@Autowired
	private RefreshTokenRepository refreshTokenRepository;

	@Autowired
	private PasswordEncoder passwordEncoder;

	@BeforeEach
	void createActiveUser() {
		User user = new User();
		user.setEmail(EMAIL);
		user.setPasswordHash(passwordEncoder.encode(PASSWORD));
		user.setDisplayName("Login user");
		userRepository.saveAndFlush(user);
	}

	@Test
	void tc04LogsInWithValidCredentialsAndStoresRefreshTokenHash() throws Exception {
		MvcResult result = mockMvc.perform(loginRequest(EMAIL, PASSWORD))
				.andExpect(status().isOk())
				.andExpect(jsonPath("$.user.id").isNotEmpty())
				.andExpect(jsonPath("$.user.email").value(EMAIL))
				.andExpect(jsonPath("$.user.display_name").value("Login user"))
				.andExpect(jsonPath("$.user.role").value("user"))
				.andExpect(jsonPath("$.user.has_avatar").value(false))
				.andExpect(jsonPath("$.tokens.access_token").isNotEmpty())
				.andExpect(jsonPath("$.tokens.refresh_token").isNotEmpty())
				.andExpect(jsonPath("$.tokens.expires_in").value(900))
				.andReturn();

		String refreshToken = com.jayway.jsonpath.JsonPath.read(
				result.getResponse().getContentAsString(),
				"$.tokens.refresh_token");
		String expectedHash = HexFormat.of().formatHex(
				MessageDigest.getInstance("SHA-256").digest(refreshToken.getBytes(StandardCharsets.UTF_8)));
		RefreshToken storedToken = refreshTokenRepository.findByTokenHash(expectedHash).orElseThrow();

		assertThat(storedToken.getTokenHash()).isEqualTo(expectedHash);
		assertThat(storedToken.getTokenHash()).isNotEqualTo(refreshToken);
		assertThat(storedToken.getExpiresAt()).isAfter(Instant.now());
		assertThat(storedToken.getRevokedAt()).isNull();
	}

	@Test
	void tc05RejectsWrongPasswordWithoutRevealingWhichCredentialFailed() throws Exception {
		long tokenCountBefore = refreshTokenRepository.count();
		MvcResult result = mockMvc.perform(loginRequest(EMAIL, "WrongPass123"))
				.andExpect(status().isUnauthorized())
				.andExpect(jsonPath("$.error.code").value("UNAUTHORIZED"))
				.andReturn();

		assertThat(refreshTokenRepository.count()).isEqualTo(tokenCountBefore);
		assertThat(result.getResponse().getContentAsString()).isEqualTo(invalidEmailResponseBody());
	}

	@Test
	void tc06RejectsUnknownEmailWithSameResponseAsWrongPassword() throws Exception {
		long tokenCountBefore = refreshTokenRepository.count();
		MvcResult wrongPassword = mockMvc.perform(loginRequest(EMAIL, "WrongPass123"))
				.andExpect(status().isUnauthorized())
				.andReturn();
		MvcResult unknownEmail = mockMvc.perform(loginRequest("missing@example.com", PASSWORD))
				.andExpect(status().isUnauthorized())
				.andReturn();

		assertThat(unknownEmail.getResponse().getContentAsString())
				.isEqualTo(wrongPassword.getResponse().getContentAsString());
		assertThat(refreshTokenRepository.count()).isEqualTo(tokenCountBefore);
	}

	private String invalidEmailResponseBody() throws Exception {
		return mockMvc.perform(loginRequest("missing@example.com", PASSWORD))
				.andExpect(status().isUnauthorized())
				.andReturn()
				.getResponse()
				.getContentAsString();
	}

	private org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder loginRequest(
			String email,
			String password) {
		String body = """
				{
				  "email": "%s",
				  "password": "%s"
				}
				""".formatted(email, password);
		return post("/auth/login")
				.contentType(MediaType.APPLICATION_JSON)
				.content(body);
	}
}
