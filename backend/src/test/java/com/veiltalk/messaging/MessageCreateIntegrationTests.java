package com.veiltalk.messaging;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.reset;
import static org.mockito.Mockito.verify;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.sql.Timestamp;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.veiltalk.auth.JwtService;
import com.veiltalk.auth.User;
import com.veiltalk.auth.UserRepository;

@SpringBootTest
@AutoConfigureMockMvc
class MessageCreateIntegrationTests {

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

	@Autowired
	private JdbcTemplate jdbcTemplate;

	@MockitoBean
	private MessageRealtimePublisher realtimePublisher;

	private final List<UUID> messageIds = new ArrayList<>();
	private final List<UUID> conversationIds = new ArrayList<>();
	private final List<UUID> userIds = new ArrayList<>();

	private User sender;
	private User recipient;
	private User outsider;
	private Conversation conversation;
	private String senderToken;

	@BeforeEach
	void createFixture() {
		reset(realtimePublisher);
		sender = createUser("sender");
		recipient = createUser("recipient");
		outsider = createUser("outsider");
		conversation = createConversation(
				sender,
				recipient,
				Instant.now().minusSeconds(60));
		senderToken = tokenFor(sender);
	}

	@AfterEach
	void removeFixture() {
		messageIds.forEach(id -> jdbcTemplate.update("DELETE FROM messages WHERE id = ?", id));
		conversationIds.forEach(
				id -> jdbcTemplate.update("DELETE FROM conversations WHERE id = ?", id));
		userIds.forEach(id -> jdbcTemplate.update("DELETE FROM users WHERE id = ?", id));
	}

	@Test
	void tc23CreatesMessageAndPublishesAfterCommit() throws Exception {
		UUID messageId = trackMessageId(UUID.randomUUID());
		Instant clientTimestamp = Instant.now();
		Instant previousConversationUpdatedAt = conversation.getUpdatedAt();

		mockMvc.perform(authenticatedPost(
						conversation.getId(),
						senderToken,
						requestBody(messageId, "Xin chào!", clientTimestamp)))
				.andExpect(status().isCreated())
				.andExpect(jsonPath("$.id").value(messageId.toString()))
				.andExpect(jsonPath("$.conversation_id").value(conversation.getId().toString()))
				.andExpect(jsonPath("$.sender_id").value(sender.getId().toString()))
				.andExpect(jsonPath("$.content").value("Xin chào!"))
				.andExpect(jsonPath("$.status").value("sent"))
				.andExpect(jsonPath("$.client_timestamp").exists())
				.andExpect(jsonPath("$.created_at").exists());

		var persisted = jdbcTemplate.queryForMap(
				"SELECT sender_id, content, status FROM messages WHERE id = ?",
				messageId);
		assertThat(persisted.get("sender_id")).isEqualTo(sender.getId());
		assertThat(persisted.get("content")).isEqualTo("Xin chào!");
		assertThat(persisted.get("status")).isEqualTo("sent");
		assertThat(conversationRepository.findById(conversation.getId()).orElseThrow().getUpdatedAt())
				.isAfter(previousConversationUpdatedAt);
		verify(realtimePublisher).publishNewMessage(eq(recipient.getId()), any(MessageResponse.class));
	}

	@Test
	void tc24ReturnsOriginalMessageWithoutTouchingOrRepublishing() throws Exception {
		UUID messageId = trackMessageId(UUID.randomUUID());
		mockMvc.perform(authenticatedPost(
						conversation.getId(),
						senderToken,
						requestBody(messageId, "Original", Instant.now())))
				.andExpect(status().isCreated());
		Instant updatedAfterInsert = conversationRepository.findById(conversation.getId())
				.orElseThrow()
				.getUpdatedAt();
		reset(realtimePublisher);

		JsonNode response = responseJson(
				mockMvc.perform(authenticatedPost(
								conversation.getId(),
								senderToken,
								requestBody(
										messageId,
										"Payload retry bị thay đổi",
										Instant.now().minusSeconds(600))))
						.andExpect(status().isOk())
						.andExpect(jsonPath("$.content").value("Original"))
						.andReturn().getResponse().getContentAsString());

		assertThat(response.get("id").asText()).isEqualTo(messageId.toString());
		assertThat(conversationRepository.findById(conversation.getId()).orElseThrow().getUpdatedAt())
				.isEqualTo(updatedAfterInsert);
		verify(realtimePublisher, never()).publishNewMessage(any(), any());
	}

	@Test
	void tc25RejectsClientTimestampOutsideFiveMinuteWindow() throws Exception {
		UUID messageId = trackMessageId(UUID.randomUUID());

		mockMvc.perform(authenticatedPost(
						conversation.getId(),
						senderToken,
						requestBody(messageId, "Too late", Instant.now().minusSeconds(601))))
				.andExpect(status().isBadRequest())
				.andExpect(jsonPath("$.error.code").value("VALIDATION_ERROR"));

		assertThat(jdbcTemplate.queryForObject(
				"SELECT COUNT(*) FROM messages WHERE id = ?",
				Integer.class,
				messageId))
				.isZero();
		verify(realtimePublisher, never()).publishNewMessage(any(), any());
	}

	@Test
	void rejectsMessageIdOwnedByAnotherSenderOrConversation() throws Exception {
		UUID otherSenderMessageId = trackMessageId(UUID.randomUUID());
		mockMvc.perform(authenticatedPost(
						conversation.getId(),
						tokenFor(recipient),
						requestBody(otherSenderMessageId, "From recipient", Instant.now())))
				.andExpect(status().isCreated());

		mockMvc.perform(authenticatedPost(
						conversation.getId(),
						senderToken,
						requestBody(otherSenderMessageId, "Collision", Instant.now())))
				.andExpect(status().isConflict())
				.andExpect(jsonPath("$.error.code").value("CONFLICT"));

		Conversation secondConversation = createConversation(
				sender,
				outsider,
				Instant.now().minusSeconds(60));
		UUID otherConversationMessageId = trackMessageId(UUID.randomUUID());
		mockMvc.perform(authenticatedPost(
						conversation.getId(),
						senderToken,
						requestBody(otherConversationMessageId, "First conversation", Instant.now())))
				.andExpect(status().isCreated());

		mockMvc.perform(authenticatedPost(
						secondConversation.getId(),
						senderToken,
						requestBody(otherConversationMessageId, "Collision", Instant.now())))
				.andExpect(status().isConflict())
				.andExpect(jsonPath("$.error.code").value("CONFLICT"));
	}

	@Test
	void validatesContentMembershipConversationAndSession() throws Exception {
		UUID invalidContentId = trackMessageId(UUID.randomUUID());
		mockMvc.perform(authenticatedPost(
						conversation.getId(),
						senderToken,
						requestBody(invalidContentId, "   ", Instant.now())))
				.andExpect(status().isBadRequest())
				.andExpect(jsonPath("$.error.code").value("VALIDATION_ERROR"));

		mockMvc.perform(authenticatedPost(
						conversation.getId(),
						tokenFor(outsider),
						requestBody(trackMessageId(UUID.randomUUID()), "Forbidden", Instant.now())))
				.andExpect(status().isForbidden());

		mockMvc.perform(authenticatedPost(
						UUID.randomUUID(),
						senderToken,
						requestBody(trackMessageId(UUID.randomUUID()), "Missing", Instant.now())))
				.andExpect(status().isNotFound());

		sender.setDeletedAt(Instant.now());
		userRepository.saveAndFlush(sender);
		mockMvc.perform(authenticatedPost(
						conversation.getId(),
						senderToken,
						requestBody(trackMessageId(UUID.randomUUID()), "Deleted sender", Instant.now())))
				.andExpect(status().isUnauthorized());
	}

	private User createUser(String prefix) {
		User user = new User();
		user.setEmail(prefix + "-" + UUID.randomUUID() + "@example.com");
		user.setPasswordHash("test-only-hash");
		user.setDisplayName(prefix);
		User persisted = userRepository.saveAndFlush(user);
		userIds.add(persisted.getId());
		return persisted;
	}

	private Conversation createConversation(User first, User second, Instant updatedAt) {
		UUID userAId = first.getId().toString().compareTo(second.getId().toString()) < 0
				? first.getId()
				: second.getId();
		UUID userBId = userAId.equals(first.getId()) ? second.getId() : first.getId();
		UUID conversationId = UUID.randomUUID();
		conversationIds.add(conversationId);
		jdbcTemplate.update(
				"""
						INSERT INTO conversations
							(id, user_a_id, user_b_id, created_at, updated_at)
						VALUES (?, ?, ?, ?, ?)
						""",
				conversationId,
				userAId,
				userBId,
				Timestamp.from(updatedAt),
				Timestamp.from(updatedAt));
		return conversationRepository.findById(conversationId).orElseThrow();
	}

	private UUID trackMessageId(UUID id) {
		messageIds.add(id);
		return id;
	}

	private String tokenFor(User user) {
		return jwtService.generateAccessToken(user.getId(), user.getRole());
	}

	private org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder authenticatedPost(
			UUID conversationId,
			String accessToken,
			String body) {
		return post("/conversations/" + conversationId + "/messages")
				.header("Authorization", "Bearer " + accessToken)
				.contentType(MediaType.APPLICATION_JSON)
				.content(body);
	}

	private String requestBody(
			UUID messageId,
			String content,
			Instant clientTimestamp) throws Exception {
		return objectMapper.writeValueAsString(new RequestBody(messageId, content, clientTimestamp));
	}

	private JsonNode responseJson(String responseBody) throws Exception {
		return objectMapper.readTree(responseBody);
	}

	private record RequestBody(
			UUID id,
			String content,
			Instant client_timestamp) {
	}
}
