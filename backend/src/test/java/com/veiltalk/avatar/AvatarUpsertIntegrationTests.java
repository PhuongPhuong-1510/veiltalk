package com.veiltalk.avatar;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.util.UUID;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.transaction.annotation.Transactional;

import com.veiltalk.auth.JwtService;
import com.veiltalk.auth.User;
import com.veiltalk.auth.UserRepository;

@SpringBootTest
@AutoConfigureMockMvc
@Transactional
class AvatarUpsertIntegrationTests {

	@Autowired
	private MockMvc mockMvc;

	@Autowired
	private AvatarProfileRepository avatarProfileRepository;

	@Autowired
	private UserRepository userRepository;

	@Autowired
	private JwtService jwtService;

	private User user;
	private String accessToken;

	@BeforeEach
	void createUser() {
		user = new User();
		user.setEmail("avatar-" + UUID.randomUUID() + "@example.com");
		user.setPasswordHash("test-only-hash");
		user.setDisplayName("Avatar user");
		user = userRepository.saveAndFlush(user);
		accessToken = jwtService.generateAccessToken(user.getId(), user.getRole());
	}

	@Test
	void tc11CreatesAvatarAndUsesServerControlledModelUrl() throws Exception {
		mockMvc.perform(upsertRequest("""
				{
				  "model_id": "avatar_model_01",
				  "customizations": {}
				}
				"""))
				.andExpect(status().isCreated());

		AvatarProfile profile = avatarProfileRepository.findByUserId(user.getId()).orElseThrow();
		assertThat(profile.getModelId()).isEqualTo("avatar_model_01");
		assertThat(profile.getModelUrl())
				.isEqualTo("https://cdn.veiltalk.example.com/models/avatar_model_01.glb");
		assertThat(profile.getCustomizations()).isEmpty();
	}

	@Test
	void tc12UpdatesExistingAvatarWithoutCreatingDuplicate() throws Exception {
		mockMvc.perform(upsertRequest("""
				{"model_id":"avatar_model_01","customizations":{}}
				"""))
				.andExpect(status().isCreated());

		mockMvc.perform(upsertRequest("""
				{
				  "model_id": "avatar_model_02",
				  "customizations": {
				    "hair_color": "#112233",
				    "outfit": "street_01"
				  }
				}
				"""))
				.andExpect(status().isOk());

		assertThat(avatarProfileRepository.findAll()).hasSize(1);
		AvatarProfile profile = avatarProfileRepository.findByUserId(user.getId()).orElseThrow();
		assertThat(profile.getModelId()).isEqualTo("avatar_model_02");
		assertThat(profile.getCustomizations())
				.containsEntry("hair_color", "#112233")
				.containsEntry("outfit", "street_01");
	}

	@Test
	void tc13RejectsUnknownModelId() throws Exception {
		mockMvc.perform(upsertRequest("""
				{"model_id":"fake_model_999","customizations":{}}
				"""))
				.andExpect(status().isBadRequest())
				.andExpect(jsonPath("$.error.code").value("VALIDATION_ERROR"));

		assertThat(avatarProfileRepository.findByUserId(user.getId())).isEmpty();
	}

	@Test
	void rejectsUnsupportedCustomizationAndOutfit() throws Exception {
		mockMvc.perform(upsertRequest("""
				{"model_id":"avatar_model_01","customizations":{"height":"tall"}}
				"""))
				.andExpect(status().isBadRequest())
				.andExpect(jsonPath("$.error.code").value("VALIDATION_ERROR"));

		mockMvc.perform(upsertRequest("""
				{"model_id":"avatar_model_01","customizations":{"outfit":"unknown"}}
				"""))
				.andExpect(status().isBadRequest())
				.andExpect(jsonPath("$.error.code").value("VALIDATION_ERROR"));
	}

	@Test
	void rejectsClientControlledModelUrl() throws Exception {
		mockMvc.perform(upsertRequest("""
				{
				  "model_id": "avatar_model_01",
				  "model_url": "https://attacker.example/model.glb",
				  "customizations": {}
				}
				"""))
				.andExpect(status().isBadRequest())
				.andExpect(jsonPath("$.error.code").value("VALIDATION_ERROR"));
	}

	private org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder upsertRequest(String body) {
		return put("/avatars/me")
				.header("Authorization", "Bearer " + accessToken)
				.contentType(MediaType.APPLICATION_JSON)
				.content(body);
	}
}
