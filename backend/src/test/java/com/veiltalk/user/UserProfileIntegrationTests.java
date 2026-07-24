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

import jakarta.persistence.EntityManager;

@SpringBootTest
@AutoConfigureMockMvc
@Transactional
class UserProfileIntegrationTests {

	private static final String EMAIL = "profile@example.com";

	@Autowired
	private MockMvc mockMvc;

	@Autowired
	private UserRepository userRepository;

	@Autowired
	private PasswordEncoder passwordEncoder;

	@Autowired
	private JwtService jwtService;

	@Autowired
	private EntityManager entityManager;

	private User user;
	private String accessToken;

	@BeforeEach
	void createActiveUser() {
		user = new User();
		user.setEmail(EMAIL);
		user.setPasswordHash(passwordEncoder.encode("Secure123"));
		user.setDisplayName("Profile user");
		user.setAvatarUrl("https://cdn.example.com/old.png");
		user = userRepository.saveAndFlush(user);
		entityManager.refresh(user);
		accessToken = jwtService.generateAccessToken(user.getId(), user.getRole());
	}

	@Test
	void getsCurrentUserProfile() throws Exception {
		mockMvc.perform(authenticatedGet())
				.andExpect(status().isOk())
				.andExpect(jsonPath("$.id").value(user.getId().toString()))
				.andExpect(jsonPath("$.email").value(EMAIL))
				.andExpect(jsonPath("$.display_name").value("Profile user"))
				.andExpect(jsonPath("$.avatar_url").value("https://cdn.example.com/old.png"))
				.andExpect(jsonPath("$.role").value("user"))
				.andExpect(jsonPath("$.has_avatar").value(false))
				.andExpect(jsonPath("$.created_at").isNotEmpty());
	}

	@Test
	void updatesOnlyProvidedProfileFieldsAndPersistsThem() throws Exception {
		mockMvc.perform(authenticatedPut("""
					{
					  "display_name": "Updated user"
					}
					"""))
				.andExpect(status().isOk())
				.andExpect(jsonPath("$.display_name").value("Updated user"))
				.andExpect(jsonPath("$.avatar_url").value("https://cdn.example.com/old.png"));

		User updated = userRepository.findByIdAndDeletedAtIsNull(user.getId()).orElseThrow();
		assertThat(updated.getDisplayName()).isEqualTo("Updated user");
		assertThat(updated.getAvatarUrl()).isEqualTo("https://cdn.example.com/old.png");
	}

	@Test
	void clearsAvatarUrlWhenExplicitNullIsProvided() throws Exception {
		mockMvc.perform(authenticatedPut("""
					{ "avatar_url": null }
					"""))
				.andExpect(status().isOk())
				.andExpect(jsonPath("$.avatar_url").doesNotExist())
				.andExpect(jsonPath("$.display_name").value("Profile user"));

		assertThat(userRepository.findByIdAndDeletedAtIsNull(user.getId()).orElseThrow().getAvatarUrl())
				.isNull();
	}

	@Test
	void acceptsEmptyUpdateWithoutChangingProfile() throws Exception {
		mockMvc.perform(authenticatedPut("{}"))
				.andExpect(status().isOk())
				.andExpect(jsonPath("$.display_name").value("Profile user"))
				.andExpect(jsonPath("$.avatar_url").value("https://cdn.example.com/old.png"));
	}

	@Test
	void rejectsEmptyDisplayName() throws Exception {
		mockMvc.perform(authenticatedPut("""
					{ "display_name": "" }
					"""))
				.andExpect(status().isBadRequest())
				.andExpect(jsonPath("$.error.code").value("VALIDATION_ERROR"));
	}

	@Test
	void rejectsDisplayNameLongerThanOneHundredCharacters() throws Exception {
		mockMvc.perform(authenticatedPut("""
					{ "display_name": "%s" }
					""".formatted("a".repeat(101))))
				.andExpect(status().isBadRequest())
				.andExpect(jsonPath("$.error.code").value("VALIDATION_ERROR"));
	}

	@Test
	void rejectsRequestWithoutAccessToken() throws Exception {
		mockMvc.perform(get("/users/me"))
				.andExpect(status().isUnauthorized())
				.andExpect(jsonPath("$.error.code").value("UNAUTHORIZED"));
	}

	@Test
	void returnsSameUnauthorizedResponseForMissingAndSoftDeletedUsers() throws Exception {
		String missingUserToken = jwtService.generateAccessToken(
				java.util.UUID.randomUUID(),
				user.getRole());
		String missingResponse = mockMvc.perform(get("/users/me")
						.header("Authorization", "Bearer " + missingUserToken))
				.andExpect(status().isUnauthorized())
				.andExpect(jsonPath("$.error.code").value("UNAUTHORIZED"))
				.andReturn()
				.getResponse()
				.getContentAsString();

		user.setDeletedAt(Instant.now());
		userRepository.saveAndFlush(user);
		String deletedResponse = mockMvc.perform(authenticatedGet())
				.andExpect(status().isUnauthorized())
				.andExpect(jsonPath("$.error.code").value("UNAUTHORIZED"))
				.andReturn()
				.getResponse()
				.getContentAsString();

		assertThat(deletedResponse).isEqualTo(missingResponse);
	}

	private org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder authenticatedGet() {
		return get("/users/me")
				.header("Authorization", "Bearer " + accessToken);
	}

	private org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder authenticatedPut(String body) {
		return put("/users/me")
				.header("Authorization", "Bearer " + accessToken)
				.contentType(MediaType.APPLICATION_JSON)
				.content(body);
	}
}
