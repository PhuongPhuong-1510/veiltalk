package com.veiltalk.messaging;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.time.Instant;
import java.util.UUID;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.transaction.annotation.Transactional;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.veiltalk.auth.JwtService;
import com.veiltalk.auth.User;
import com.veiltalk.auth.UserRepository;

@SpringBootTest
@AutoConfigureMockMvc
@Transactional
class ConversationCreateIntegrationTests {

	@Autowired
	private MockMvc mockMvc;

	@Autowired
	private ObjectMapper objectMapper;

	@Autowired
	private UserRepository userRepository;

	@Autowired
	private ConversationRepository conversationRepository;

	@Autowired
	private JwtService jwtService;

	private User requester;
	private User otherUser;
	private String requesterToken;

	@BeforeEach
	void createUsers() {
		requester = createUser("requester", null);
		otherUser = createUser("other-user", "https://cdn.example.com/avatar.png");
		requesterToken = jwtService.generateAccessToken(requester.getId(), requester.getRole());
	}

	@Test
	void tc21CreatesConversationWithOtherUserProfile() throws Exception {
		mockMvc.perform(authenticatedPost(requesterToken, otherUser.getId()))
				.andExpect(status().isCreated())
				.andExpect(jsonPath("$.id").isNotEmpty())
				.andExpect(jsonPath("$.other_user.id").value(otherUser.getId().toString()))
				.andExpect(jsonPath("$.other_user.display_name").value(otherUser.getDisplayName()))
				.andExpect(jsonPath("$.other_user.avatar_url").value(otherUser.getAvatarUrl()))
				.andExpect(jsonPath("$.other_user.email").doesNotExist())
				.andExpect(jsonPath("$.created_at").exists())
				.andExpect(jsonPath("$.updated_at").exists());

		assertThat(conversationRepository.findAll()).hasSize(1);
	}

	@Test
	void tc22ReturnsSameConversationWhenPairAlreadyExists() throws Exception {
		JsonNode firstResponse = responseJson(
				mockMvc.perform(authenticatedPost(requesterToken, otherUser.getId()))
						.andExpect(status().isCreated())
						.andReturn().getResponse().getContentAsString());

		JsonNode secondResponse = responseJson(
				mockMvc.perform(authenticatedPost(requesterToken, otherUser.getId()))
						.andExpect(status().isOk())
						.andReturn().getResponse().getContentAsString());

		assertThat(secondResponse.get("id").asText()).isEqualTo(firstResponse.get("id").asText());
		assertThat(conversationRepository.findAll()).hasSize(1);
	}

	@Test
	void treatsReverseUserOrderAsTheSameConversation() throws Exception {
		String otherUserToken = jwtService.generateAccessToken(otherUser.getId(), otherUser.getRole());
		JsonNode firstResponse = responseJson(
				mockMvc.perform(authenticatedPost(requesterToken, otherUser.getId()))
						.andExpect(status().isCreated())
						.andReturn().getResponse().getContentAsString());

		JsonNode reverseResponse = responseJson(
				mockMvc.perform(authenticatedPost(otherUserToken, requester.getId()))
						.andExpect(status().isOk())
						.andExpect(jsonPath("$.other_user.id").value(requester.getId().toString()))
						.andReturn().getResponse().getContentAsString());

		assertThat(reverseResponse.get("id").asText()).isEqualTo(firstResponse.get("id").asText());
		assertThat(conversationRepository.findAll()).hasSize(1);
	}

	@Test
	void rejectsSelfConversationAndMissingOtherUser() throws Exception {
		mockMvc.perform(authenticatedPost(requesterToken, requester.getId()))
				.andExpect(status().isBadRequest())
				.andExpect(jsonPath("$.error.code").value("VALIDATION_ERROR"));

		mockMvc.perform(authenticatedPost(requesterToken, UUID.randomUUID()))
				.andExpect(status().isNotFound())
				.andExpect(jsonPath("$.error.code").value("NOT_FOUND"));
	}

	@Test
	void rejectsMissingOrMalformedOtherUserId() throws Exception {
		mockMvc.perform(post("/conversations")
						.header("Authorization", "Bearer " + requesterToken)
						.contentType(MediaType.APPLICATION_JSON)
						.content("{}"))
				.andExpect(status().isBadRequest())
				.andExpect(jsonPath("$.error.code").value("VALIDATION_ERROR"));

		mockMvc.perform(post("/conversations")
						.header("Authorization", "Bearer " + requesterToken)
						.contentType(MediaType.APPLICATION_JSON)
						.content("""
								{"other_user_id":"not-a-uuid"}
								"""))
				.andExpect(status().isBadRequest())
				.andExpect(jsonPath("$.error.code").value("VALIDATION_ERROR"));
	}

	@Test
	void requiresAuthenticationAndRejectsSoftDeletedUsers() throws Exception {
		mockMvc.perform(post("/conversations")
						.contentType(MediaType.APPLICATION_JSON)
						.content(requestBody(otherUser.getId())))
				.andExpect(status().isUnauthorized());

		otherUser.setDeletedAt(Instant.now());
		userRepository.saveAndFlush(otherUser);
		mockMvc.perform(authenticatedPost(requesterToken, otherUser.getId()))
				.andExpect(status().isNotFound());
	}

	private User createUser(String prefix, String avatarUrl) {
		User user = new User();
		user.setEmail(prefix + "-" + UUID.randomUUID() + "@example.com");
		user.setPasswordHash("test-only-hash");
		user.setDisplayName(prefix);
		user.setAvatarUrl(avatarUrl);
		return userRepository.saveAndFlush(user);
	}

	private org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder authenticatedPost(
			String accessToken,
			UUID otherUserId) {
		return post("/conversations")
				.header("Authorization", "Bearer " + accessToken)
				.contentType(MediaType.APPLICATION_JSON)
				.content(requestBody(otherUserId));
	}

	private String requestBody(UUID otherUserId) {
		return """
				{"other_user_id":"%s"}
				""".formatted(otherUserId);
	}

	private JsonNode responseJson(String responseBody) throws Exception {
		return objectMapper.readTree(responseBody);
	}
}
