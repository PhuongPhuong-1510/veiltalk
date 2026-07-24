package com.veiltalk.user;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.time.Instant;

import com.veiltalk.auth.JwtService;
import com.veiltalk.auth.User;
import com.veiltalk.auth.UserRepository;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.transaction.annotation.Transactional;

@SpringBootTest
@AutoConfigureMockMvc
@Transactional
class UserSettingsIntegrationTests {

	@Autowired
	private MockMvc mockMvc;

	@Autowired
	private UserRepository userRepository;

	@Autowired
	private PasswordEncoder passwordEncoder;

	@Autowired
	private JwtService jwtService;

	private User user;
	private String accessToken;

	@BeforeEach
	void createActiveUser() {
		user = new User();
		user.setEmail("settings@example.com");
		user.setPasswordHash(passwordEncoder.encode("Secure123"));
		user.setDisplayName("Settings user");
		user = userRepository.saveAndFlush(user);
		accessToken = jwtService.generateAccessToken(user.getId(), user.getRole());
	}

	@Test
	void returnsDocumentedDefaultSettings() throws Exception {
		mockMvc.perform(authenticatedGet())
				.andExpect(status().isOk())
				.andExpect(jsonPath("$.discoverable").value(false))
				.andExpect(jsonPath("$.email_notifications").value(true))
				.andExpect(jsonPath("$.theme").value("system"));
	}

	@Test
	void tc20TurnsDiscoverabilityOnAndOff() throws Exception {
		mockMvc.perform(authenticatedPut("""
					{ "discoverable": true }
					"""))
				.andExpect(status().isOk())
				.andExpect(jsonPath("$.discoverable").value(true));
		mockMvc.perform(authenticatedGet())
				.andExpect(status().isOk())
				.andExpect(jsonPath("$.discoverable").value(true));

		mockMvc.perform(authenticatedPut("""
					{ "discoverable": false }
					"""))
				.andExpect(status().isOk())
				.andExpect(jsonPath("$.discoverable").value(false));
		mockMvc.perform(authenticatedGet())
				.andExpect(status().isOk())
				.andExpect(jsonPath("$.discoverable").value(false));
	}

	@Test
	void partiallyUpdatesEmailNotificationsWithoutChangingOtherSettings() throws Exception {
		mockMvc.perform(authenticatedPut("""
					{ "email_notifications": false }
					"""))
				.andExpect(status().isOk())
				.andExpect(jsonPath("$.discoverable").value(false))
				.andExpect(jsonPath("$.email_notifications").value(false))
				.andExpect(jsonPath("$.theme").value("system"));

		User updated = userRepository.findByIdAndDeletedAtIsNull(user.getId()).orElseThrow();
		assertThat(updated.isEmailNotifications()).isFalse();
		assertThat(updated.getTheme()).isEqualTo(Theme.SYSTEM);
	}

	@Test
	void updatesThemeAndPersistsLowercaseDatabaseValue() throws Exception {
		mockMvc.perform(authenticatedPut("""
					{ "theme": "dark" }
					"""))
				.andExpect(status().isOk())
				.andExpect(jsonPath("$.theme").value("dark"));

		assertThat(userRepository.findByIdAndDeletedAtIsNull(user.getId()).orElseThrow().getTheme())
				.isEqualTo(Theme.DARK);
	}

	@Test
	void rejectsNullTheme() throws Exception {
		mockMvc.perform(authenticatedPut("""
					{ "theme": null }
					"""))
				.andExpect(status().isBadRequest())
				.andExpect(jsonPath("$.error.code").value("VALIDATION_ERROR"));
	}

	@Test
	void rejectsUnsupportedTheme() throws Exception {
		mockMvc.perform(authenticatedPut("""
					{ "theme": "blue" }
					"""))
				.andExpect(status().isBadRequest())
				.andExpect(jsonPath("$.error.code").value("VALIDATION_ERROR"));
	}

	@Test
	void acceptsEmptyPartialUpdateWithoutChangingSettings() throws Exception {
		mockMvc.perform(authenticatedPut("{}"))
				.andExpect(status().isOk())
				.andExpect(jsonPath("$.discoverable").value(false))
				.andExpect(jsonPath("$.email_notifications").value(true))
				.andExpect(jsonPath("$.theme").value("system"));
	}

	@Test
	void returnsUnauthorizedForSoftDeletedUser() throws Exception {
		user.setDeletedAt(Instant.now());
		userRepository.saveAndFlush(user);

		mockMvc.perform(authenticatedGet())
				.andExpect(status().isUnauthorized())
				.andExpect(jsonPath("$.error.code").value("UNAUTHORIZED"))
				.andExpect(jsonPath("$.error.message").value("Invalid session"));
	}

	private org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder authenticatedGet() {
		return get("/users/me/settings")
				.header("Authorization", "Bearer " + accessToken);
	}

	private org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder authenticatedPut(String body) {
		return put("/users/me/settings")
				.header("Authorization", "Bearer " + accessToken)
				.contentType(MediaType.APPLICATION_JSON)
				.content(body);
	}
}
