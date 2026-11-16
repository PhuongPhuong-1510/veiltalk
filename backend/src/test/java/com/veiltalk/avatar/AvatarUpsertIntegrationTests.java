package com.veiltalk.avatar;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.multipart;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.content;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.awt.image.BufferedImage;
import java.io.ByteArrayOutputStream;
import java.util.UUID;

import javax.imageio.ImageIO;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.HttpMethod;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;
import org.springframework.test.web.servlet.request.MockMultipartHttpServletRequestBuilder;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.transaction.annotation.Transactional;

import com.veiltalk.auth.JwtService;
import com.veiltalk.auth.User;
import com.veiltalk.auth.UserRepository;

@SpringBootTest
@AutoConfigureMockMvc
@Transactional
class AvatarUpsertIntegrationTests {
	@Autowired MockMvc mockMvc;
	@Autowired AvatarProfileRepository avatarProfileRepository;
	@Autowired UserRepository userRepository;
	@Autowired JwtService jwtService;
	@MockitoBean AvatarPortraitStorage portraitStorage;

	private User user;
	private String accessToken;

	@BeforeEach void createUser() {
		user = new User(); user.setEmail("avatar-" + UUID.randomUUID() + "@example.com");
		user.setPasswordHash("test-only-hash"); user.setDisplayName("Avatar user");
		user = userRepository.saveAndFlush(user);
		accessToken = jwtService.generateAccessToken(user.getId(), user.getRole());
	}

	@Test void createsCompleteAvatarAndUsesVersionedPortraitUrl() throws Exception {
		UUID requestId = UUID.randomUUID();
		mockMvc.perform(completeRequest(requestId, null, "reference-avatar-2", "{}"))
				.andExpect(status().isOk())
				.andExpect(jsonPath("$.profile.last_save_request_id").value(requestId.toString()))
				.andExpect(jsonPath("$.user.has_avatar").value(true));
		AvatarProfile profile = avatarProfileRepository.findByUserId(user.getId()).orElseThrow();
		assertThat(profile.getModelId()).isEqualTo("reference-avatar-2");
		assertThat(profile.getPortraitObjectKey()).contains(requestId.toString());
		assertThat(userRepository.findById(user.getId()).orElseThrow().getAvatarUrl())
				.isEqualTo("/avatars/" + user.getId() + "/portrait?v=" + requestId);
	}

	@Test void updatesWithExpectedRevisionAndKeepsOneProfile() throws Exception {
		mockMvc.perform(completeRequest(UUID.randomUUID(), null, "reference-avatar-2", "{}"))
				.andExpect(status().isOk());
		UUID revision = avatarProfileRepository.findByUserId(user.getId()).orElseThrow().getProfileRevision();
		mockMvc.perform(completeRequest(UUID.randomUUID(), revision, "reference-avatar-3",
				"{\"colors\":{\"hair\":\"#112233\"}}"))
				.andExpect(status().isOk());
		assertThat(avatarProfileRepository.findByUserId(user.getId())).isPresent();
		assertThat(avatarProfileRepository.findByUserId(user.getId()).orElseThrow().getModelId())
				.isEqualTo("reference-avatar-3");
	}

	@Test void retryWithSameRequestIsIdempotent() throws Exception {
		UUID requestId = UUID.randomUUID();
		var request = completeRequest(requestId, null, "reference-avatar-2", "{}");
		mockMvc.perform(request).andExpect(status().isOk());
		mockMvc.perform(completeRequest(requestId, null, "reference-avatar-2", "{}"))
				.andExpect(status().isOk());
		assertThat(avatarProfileRepository.findByUserId(user.getId())).isPresent();
	}

	@Test void rejectsDuplicateOnboardingAndStaleEditRevision() throws Exception {
		mockMvc.perform(completeRequest(UUID.randomUUID(), null, "reference-avatar-2", "{}"))
				.andExpect(status().isOk());
		UUID currentRevision = avatarProfileRepository.findByUserId(user.getId()).orElseThrow().getProfileRevision();

		mockMvc.perform(completeRequest(UUID.randomUUID(), null, "reference-avatar-3", "{}"))
				.andExpect(status().isConflict())
				.andExpect(jsonPath("$.error.code").value("AVATAR_ALREADY_EXISTS"));
		mockMvc.perform(completeRequest(UUID.randomUUID(), UUID.randomUUID(), "reference-avatar-3", "{}"))
				.andExpect(status().isConflict())
				.andExpect(jsonPath("$.error.code").value("AVATAR_REVISION_CONFLICT"));

		assertThat(avatarProfileRepository.findByUserId(user.getId()).orElseThrow().getProfileRevision())
				.isEqualTo(currentRevision);
	}

	@Test void rejectsReusingRequestIdWithDifferentPayload() throws Exception {
		UUID requestId = UUID.randomUUID();
		mockMvc.perform(completeRequest(requestId, null, "reference-avatar-2", "{}"))
				.andExpect(status().isOk());

		mockMvc.perform(completeRequest(requestId, null, "reference-avatar-3", "{}"))
				.andExpect(status().isConflict())
				.andExpect(jsonPath("$.error.code").value("IDEMPOTENCY_CONFLICT"));
	}

	@Test void servesPortraitPubliclyWithEtagRevalidation() throws Exception {
		UUID requestId = UUID.randomUUID();
		byte[] image = png();
		mockMvc.perform(completeRequest(requestId, null, "reference-avatar-2", "{}"))
				.andExpect(status().isOk());
		String objectKey = avatarProfileRepository.findByUserId(user.getId()).orElseThrow().getPortraitObjectKey();
		when(portraitStorage.get(objectKey)).thenReturn(image);

		mockMvc.perform(get("/avatars/{userId}/portrait", user.getId()))
				.andExpect(status().isOk())
				.andExpect(header().string("Cache-Control", "public, no-cache"))
				.andExpect(header().string("Cross-Origin-Resource-Policy", "cross-origin"))
				.andExpect(header().string("ETag", "\"" + requestId + "\""))
				.andExpect(content().contentType("image/png"))
				.andExpect(content().bytes(image));
		mockMvc.perform(get("/avatars/{userId}/portrait", user.getId())
				.header("If-None-Match", "\"" + requestId + "\""))
				.andExpect(status().isNotModified())
				.andExpect(header().string("Cross-Origin-Resource-Policy", "cross-origin"))
				.andExpect(header().string("Cache-Control", "public, no-cache"));
	}

	@Test void rejectsUnknownModelAndInvalidCustomization() throws Exception {
		mockMvc.perform(completeRequest(UUID.randomUUID(), null, "fake_model_999", "{}"))
				.andExpect(status().isBadRequest());
		mockMvc.perform(completeRequest(UUID.randomUUID(), null, "reference-avatar-2",
				"{\"colors\":{\"hair\":\"red\"}}"))
				.andExpect(status().isBadRequest());
	}

	@Test void legacyWriteEndpointIsDisabled() throws Exception {
		mockMvc.perform(put("/avatars/me").header("Authorization", "Bearer " + accessToken)
				.contentType("application/json").content("{\"model_id\":\"reference-avatar-2\"}"))
				.andExpect(status().isMethodNotAllowed());
	}

	private MockHttpServletRequestBuilder completeRequest(UUID requestId, UUID expectedRevision,
			String modelId, String customizations) throws Exception {
		MockMultipartHttpServletRequestBuilder request = multipart(HttpMethod.PUT, "/avatars/me/complete");
		request.file(new MockMultipartFile("portrait", "avatar.png", "image/png", png()));
		request.param("request_id", requestId.toString());
		request.param("model_id", modelId);
		request.param("customizations", customizations);
		if (expectedRevision != null) request.param("expected_revision", expectedRevision.toString());
		return request.header("Authorization", "Bearer " + accessToken);
	}

	private byte[] png() throws Exception {
		BufferedImage image = new BufferedImage(512, 512, BufferedImage.TYPE_INT_ARGB);
		ByteArrayOutputStream output = new ByteArrayOutputStream(); ImageIO.write(image, "png", output);
		return output.toByteArray();
	}
}
