package com.veiltalk.avatar;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.content;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.time.Instant;
import java.util.Map;
import java.util.UUID;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.transaction.annotation.Transactional;

import com.veiltalk.auth.JwtService;
import com.veiltalk.auth.User;
import com.veiltalk.auth.UserRepository;

import jakarta.persistence.EntityManager;

@SpringBootTest
@AutoConfigureMockMvc
@Transactional
class AvatarQueryIntegrationTests {

	@Autowired
	private MockMvc mockMvc;

	@Autowired
	private UserRepository userRepository;

	@Autowired
	private AvatarProfileRepository avatarProfileRepository;

	@Autowired
	private JwtService jwtService;

	@Autowired
	private EntityManager entityManager;

	private User requester;
	private User avatarOwner;
	private User userWithoutAvatar;
	private String accessToken;

	@BeforeEach
	void createUsersAndAvatar() {
		requester = createUser("requester");
		avatarOwner = createUser("owner");
		userWithoutAvatar = createUser("no-avatar");
		accessToken = jwtService.generateAccessToken(requester.getId(), requester.getRole());
		createAvatar(avatarOwner, "avatar_model_02", Map.of(
				"hair_color", "#112233",
				"outfit", "street_01"));
	}

	@Test
	void getsOwnAvatarWithFullProfileFields() throws Exception {
		AvatarProfile ownAvatar = createAvatar(
				requester,
				"avatar_model_01",
				Map.of("hair_color", "#445566"));
		entityManager.clear();

		mockMvc.perform(authenticatedGet("/avatars/me"))
				.andExpect(status().isOk())
				.andExpect(jsonPath("$.id").value(ownAvatar.getId().toString()))
				.andExpect(jsonPath("$.user_id").value(requester.getId().toString()))
				.andExpect(jsonPath("$.model_id").value("avatar_model_01"))
				.andExpect(jsonPath("$.model_url")
						.value("https://cdn.veiltalk.example.com/models/avatar_model_01.glb"))
				.andExpect(jsonPath("$.customizations.hair_color").value("#445566"))
				.andExpect(jsonPath("$.created_at").exists())
				.andExpect(jsonPath("$.updated_at").exists());
	}

	@Test
	void tc14GetsAnotherUsersAvatarWithoutAccountFields() throws Exception {
		mockMvc.perform(authenticatedGet("/avatars/" + avatarOwner.getId()))
				.andExpect(status().isOk())
				.andExpect(jsonPath("$.user_id").value(avatarOwner.getId().toString()))
				.andExpect(jsonPath("$.model_id").value("avatar_model_02"))
				.andExpect(jsonPath("$.model_url")
						.value("https://cdn.veiltalk.example.com/models/avatar_model_02.glb"))
				.andExpect(jsonPath("$.customizations.hair_color").value("#112233"))
				.andExpect(jsonPath("$.email").doesNotExist())
				.andExpect(jsonPath("$.role").doesNotExist())
				.andExpect(jsonPath("$.id").doesNotExist())
				.andExpect(jsonPath("$.created_at").doesNotExist())
				.andExpect(jsonPath("$.updated_at").doesNotExist());
	}

	@Test
	void tc15ReturnsSameBodyForMissingAvatarAndUnknownUser() throws Exception {
		String missingAvatarBody = mockMvc.perform(authenticatedGet("/avatars/" + userWithoutAvatar.getId()))
				.andExpect(status().isNotFound())
				.andReturn().getResponse().getContentAsString();
		String unknownUserBody = mockMvc.perform(authenticatedGet("/avatars/" + UUID.randomUUID()))
				.andExpect(status().isNotFound())
				.andReturn().getResponse().getContentAsString();

		assertThat(missingAvatarBody).isEqualTo(unknownUserBody);
	}

	@Test
	void returnsSameNotFoundBodyForSoftDeletedUser() throws Exception {
		avatarOwner.setDeletedAt(Instant.now());
		userRepository.saveAndFlush(avatarOwner);

		mockMvc.perform(authenticatedGet("/avatars/" + avatarOwner.getId()))
				.andExpect(status().isNotFound())
				.andExpect(content().json("""
						{"error":{"code":"NOT_FOUND","message":"Avatar not found","details":{}}}
						"""));
	}

	@Test
	void getOwnAvatarRequiresAuthenticationAndReturns404WhenNotConfigured() throws Exception {
		mockMvc.perform(get("/avatars/me"))
				.andExpect(status().isUnauthorized());

		mockMvc.perform(authenticatedGet("/avatars/me"))
				.andExpect(status().isNotFound())
				.andExpect(jsonPath("$.error.code").value("NOT_FOUND"));
	}

	private User createUser(String prefix) {
		User user = new User();
		user.setEmail(prefix + "-" + UUID.randomUUID() + "@example.com");
		user.setPasswordHash("test-only-hash");
		user.setDisplayName(prefix);
		return userRepository.saveAndFlush(user);
	}

	private AvatarProfile createAvatar(
			User user,
			String modelId,
			Map<String, Object> customizations) {
		AvatarProfile profile = new AvatarProfile();
		profile.setUserId(user.getId());
		profile.setModelId(modelId);
		profile.setModelUrl("https://cdn.veiltalk.example.com/models/" + modelId + ".glb");
		profile.setCustomizations(customizations);
		return avatarProfileRepository.saveAndFlush(profile);
	}

	private org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder authenticatedGet(String path) {
		return get(path).header("Authorization", "Bearer " + accessToken);
	}
}
