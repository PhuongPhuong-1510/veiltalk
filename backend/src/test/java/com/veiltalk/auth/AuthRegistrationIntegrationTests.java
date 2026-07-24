package com.veiltalk.auth;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.time.Instant;

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
class AuthRegistrationIntegrationTests {

	@Autowired
	private MockMvc mockMvc;

	@Autowired
	private UserRepository userRepository;

	@Autowired
	private RefreshTokenRepository refreshTokenRepository;

	@Autowired
	private PasswordEncoder passwordEncoder;

	@Test
	void tc01RegistersValidAccountAndReturnsTokens() throws Exception {
		MvcResult result = mockMvc.perform(registerRequest("tc01@example.com", "Secure123", "TC 01"))
				.andExpect(status().isCreated())
				.andExpect(jsonPath("$.user.id").isNotEmpty())
				.andExpect(jsonPath("$.user.email").value("tc01@example.com"))
				.andExpect(jsonPath("$.user.display_name").value("TC 01"))
				.andExpect(jsonPath("$.user.role").value("user"))
				.andExpect(jsonPath("$.user.created_at").isNotEmpty())
				.andExpect(jsonPath("$.tokens.access_token").isNotEmpty())
				.andExpect(jsonPath("$.tokens.refresh_token").isNotEmpty())
				.andExpect(jsonPath("$.tokens.expires_in").value(900))
				.andReturn();

		User savedUser = userRepository.findByEmailAndDeletedAtIsNull("tc01@example.com").orElseThrow();
		assertThat(savedUser.getPasswordHash()).isNotEqualTo("Secure123");
		assertThat(passwordEncoder.matches("Secure123", savedUser.getPasswordHash())).isTrue();

		String refreshToken = com.jayway.jsonpath.JsonPath.read(
				result.getResponse().getContentAsString(),
				"$.tokens.refresh_token");
		RefreshToken storedToken = refreshTokenRepository.findAll().stream().findFirst().orElseThrow();
		assertThat(storedToken.getUserId()).isEqualTo(savedUser.getId());
		assertThat(storedToken.getTokenHash()).isNotEqualTo(refreshToken);
		assertThat(storedToken.getRevokedAt()).isNull();
	}

	@Test
	void tc02RejectsEmailOwnedByActiveUser() throws Exception {
		mockMvc.perform(registerRequest("tc02@example.com", "Secure123", "First"))
				.andExpect(status().isCreated());

		mockMvc.perform(registerRequest("tc02@example.com", "Secure456", "Second"))
				.andExpect(status().isConflict())
				.andExpect(jsonPath("$.error.code").value("CONFLICT"));
	}

	@Test
	void tc03RejectsWeakPassword() throws Exception {
		mockMvc.perform(registerRequest("tc03@example.com", "12345", "TC 03"))
				.andExpect(status().isBadRequest())
				.andExpect(jsonPath("$.error.code").value("VALIDATION_ERROR"));

		assertThat(userRepository.findByEmailAndDeletedAtIsNull("tc03@example.com")).isEmpty();
	}

	@Test
	void registersNewAccountWhenPreviousAccountWithEmailWasSoftDeleted() throws Exception {
		User deletedUser = new User();
		deletedUser.setEmail("reused@example.com");
		deletedUser.setPasswordHash(passwordEncoder.encode("OldPass123"));
		deletedUser.setDisplayName("Deleted user");
		deletedUser.setDeletedAt(Instant.now());
		userRepository.saveAndFlush(deletedUser);
		var deletedUserId = deletedUser.getId();

		mockMvc.perform(registerRequest("reused@example.com", "NewPass123", "New user"))
				.andExpect(status().isCreated())
				.andExpect(jsonPath("$.user.id").isNotEmpty())
				.andExpect(jsonPath("$.user.email").value("reused@example.com"));

		User activeUser = userRepository.findByEmailAndDeletedAtIsNull("reused@example.com").orElseThrow();
		assertThat(activeUser.getId()).isNotEqualTo(deletedUserId);
		assertThat(deletedUser.getDeletedAt()).isNotNull();
		assertThat(userRepository.findAll())
				.filteredOn(user -> user.getEmail().equals("reused@example.com"))
				.hasSize(2);
	}

	private org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder registerRequest(
			String email,
			String password,
			String displayName) {
		String body = """
				{
				  "email": "%s",
				  "password": "%s",
				  "display_name": "%s"
				}
				""".formatted(email, password, displayName);
		return post("/auth/register")
				.contentType(MediaType.APPLICATION_JSON)
				.content(body);
	}
}
