package com.veiltalk.messaging;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.reset;
import static org.mockito.Mockito.verify;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
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
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;

import com.veiltalk.auth.JwtService;
import com.veiltalk.auth.User;
import com.veiltalk.auth.UserRepository;

@SpringBootTest
@AutoConfigureMockMvc
class MessageStatusIntegrationTests {

	@Autowired
	private MockMvc mockMvc;

	@Autowired
	private UserRepository userRepository;

	@Autowired
	private ConversationRepository conversationRepository;

	@Autowired
	private MessageRepository messageRepository;

	@Autowired
	private JdbcTemplate jdbcTemplate;

	@Autowired
	private JwtService jwtService;

	@MockitoBean
	private MessageRealtimePublisher realtimePublisher;

	private final List<UUID> userIds = new ArrayList<>();
	private final List<UUID> conversationIds = new ArrayList<>();
	private final List<UUID> messageIds = new ArrayList<>();

	private User sender;
	private User recipient;
	private User outsider;
	private Conversation conversation;
	private Message message;

	@BeforeEach
	void createFixture() {
		sender = createUser("status-sender");
		recipient = createUser("status-recipient");
		outsider = createUser("status-outsider");
		conversation = createConversation(sender, recipient);
		message = createMessage(conversation, sender, MessageStatus.SENT);
		reset(realtimePublisher);
	}

	@AfterEach
	void cleanup() {
		messageIds.forEach(id -> jdbcTemplate.update("DELETE FROM messages WHERE id = ?", id));
		conversationIds.forEach(id ->
				jdbcTemplate.update("DELETE FROM conversations WHERE id = ?", id));
		userIds.forEach(id -> jdbcTemplate.update("DELETE FROM users WHERE id = ?", id));
	}

	@Test
	void tc27RecipientUpdatesStatusAndPublishesToBothUsersAfterCommit() throws Exception {
		Instant previousUpdatedAt = loadUpdatedAt(message.getId());
		Instant conversationUpdatedAt = loadConversationUpdatedAt(conversation.getId());

		mockMvc.perform(authenticatedPut(
						path(conversation.getId(), message.getId()),
						tokenFor(recipient),
						"read"))
				.andExpect(status().isOk())
				.andExpect(jsonPath("$.id").value(message.getId().toString()))
				.andExpect(jsonPath("$.status").value("read"))
				.andExpect(jsonPath("$.updated_at").exists());

		assertThat(loadStatus(message.getId())).isEqualTo("read");
		assertThat(loadUpdatedAt(message.getId())).isAfter(previousUpdatedAt);
		assertThat(loadConversationUpdatedAt(conversation.getId())).isEqualTo(conversationUpdatedAt);
		verify(realtimePublisher).publishStatusUpdate(
				org.mockito.ArgumentMatchers.eq(sender.getId()),
				org.mockito.ArgumentMatchers.argThat(response ->
						response.id().equals(message.getId()) && response.status().equals("read")));
		verify(realtimePublisher).publishStatusUpdate(
				org.mockito.ArgumentMatchers.eq(recipient.getId()),
				org.mockito.ArgumentMatchers.argThat(response ->
						response.id().equals(message.getId()) && response.status().equals("read")));
	}

	@Test
	void allowsSentToDeliveredAndDeliveredToRead() throws Exception {
		mockMvc.perform(authenticatedPut(
						path(conversation.getId(), message.getId()),
						tokenFor(recipient),
						"delivered"))
				.andExpect(status().isOk())
				.andExpect(jsonPath("$.status").value("delivered"));
		mockMvc.perform(authenticatedPut(
						path(conversation.getId(), message.getId()),
						tokenFor(recipient),
						"read"))
				.andExpect(status().isOk())
				.andExpect(jsonPath("$.status").value("read"));
		assertThat(loadStatus(message.getId())).isEqualTo("read");
	}

	@Test
	void tc28RejectsDowngradeWithoutChangingDataOrPublishing() throws Exception {
		setStatus(message.getId(), "read");
		Instant previousUpdatedAt = loadUpdatedAt(message.getId());
		reset(realtimePublisher);

		mockMvc.perform(authenticatedPut(
						path(conversation.getId(), message.getId()),
						tokenFor(recipient),
						"delivered"))
				.andExpect(status().isBadRequest())
				.andExpect(jsonPath("$.error.code").value("VALIDATION_ERROR"));

		assertThat(loadStatus(message.getId())).isEqualTo("read");
		assertThat(loadUpdatedAt(message.getId())).isEqualTo(previousUpdatedAt);
		verify(realtimePublisher, never()).publishStatusUpdate(
				org.mockito.ArgumentMatchers.any(),
				org.mockito.ArgumentMatchers.any());
	}

	@Test
	void sameStatusIsIdempotentWithoutUpdatingOrPublishing() throws Exception {
		setStatus(message.getId(), "delivered");
		Instant previousUpdatedAt = loadUpdatedAt(message.getId());
		reset(realtimePublisher);

		mockMvc.perform(authenticatedPut(
						path(conversation.getId(), message.getId()),
						tokenFor(recipient),
						"delivered"))
				.andExpect(status().isOk())
				.andExpect(jsonPath("$.status").value("delivered"));

		assertThat(loadUpdatedAt(message.getId())).isEqualTo(previousUpdatedAt);
		verify(realtimePublisher, never()).publishStatusUpdate(
				org.mockito.ArgumentMatchers.any(),
				org.mockito.ArgumentMatchers.any());
	}

	@Test
	void senderAndOutsiderCannotUpdateStatus() throws Exception {
		for (User forbiddenUser : List.of(sender, outsider)) {
			mockMvc.perform(authenticatedPut(
							path(conversation.getId(), message.getId()),
							tokenFor(forbiddenUser),
							"read"))
					.andExpect(status().isForbidden())
					.andExpect(jsonPath("$.error.code").value("FORBIDDEN"));
		}
		assertThat(loadStatus(message.getId())).isEqualTo("sent");
		verify(realtimePublisher, never()).publishStatusUpdate(
				org.mockito.ArgumentMatchers.any(),
				org.mockito.ArgumentMatchers.any());
	}

	@Test
	void returnsNotFoundForMissingDeletedOrMismatchedResources() throws Exception {
		Conversation otherConversation = createConversation(recipient, outsider);
		for (String requestPath : List.of(
				path(UUID.randomUUID(), message.getId()),
				path(conversation.getId(), UUID.randomUUID()),
				path(otherConversation.getId(), message.getId()))) {
			mockMvc.perform(authenticatedPut(requestPath, tokenFor(recipient), "read"))
					.andExpect(status().isNotFound())
					.andExpect(jsonPath("$.error.code").value("NOT_FOUND"));
		}

		jdbcTemplate.update(
				"UPDATE messages SET deleted_at = NOW() WHERE id = ?",
				message.getId());
		mockMvc.perform(authenticatedPut(
						path(conversation.getId(), message.getId()),
						tokenFor(recipient),
						"read"))
				.andExpect(status().isNotFound());

		jdbcTemplate.update(
				"UPDATE messages SET deleted_at = NULL WHERE id = ?",
				message.getId());
		jdbcTemplate.update(
				"UPDATE conversations SET deleted_at = NOW() WHERE id = ?",
				conversation.getId());
		mockMvc.perform(authenticatedPut(
						path(conversation.getId(), message.getId()),
						tokenFor(recipient),
						"read"))
				.andExpect(status().isNotFound());
	}

	@Test
	void rejectsSentAndUnknownInputStatuses() throws Exception {
		for (String invalidStatus : List.of("sent", "unknown")) {
			mockMvc.perform(authenticatedPut(
							path(conversation.getId(), message.getId()),
							tokenFor(recipient),
							invalidStatus))
					.andExpect(status().isBadRequest())
					.andExpect(jsonPath("$.error.code").value("VALIDATION_ERROR"));
		}
		assertThat(loadStatus(message.getId())).isEqualTo("sent");
		verify(realtimePublisher, never()).publishStatusUpdate(
				org.mockito.ArgumentMatchers.any(),
				org.mockito.ArgumentMatchers.any());
	}

	private User createUser(String prefix) {
		User user = new User();
		user.setEmail(prefix + "-" + UUID.randomUUID() + "@example.com");
		user.setPasswordHash("test-only-hash");
		user.setDisplayName(prefix);
		User saved = userRepository.saveAndFlush(user);
		userIds.add(saved.getId());
		return saved;
	}

	private Conversation createConversation(User first, User second) {
		Conversation created = new Conversation();
		UUID userAId = first.getId().toString().compareTo(second.getId().toString()) < 0
				? first.getId()
				: second.getId();
		created.setUserAId(userAId);
		created.setUserBId(userAId.equals(first.getId()) ? second.getId() : first.getId());
		Conversation saved = conversationRepository.saveAndFlush(created);
		conversationIds.add(saved.getId());
		return saved;
	}

	private Message createMessage(
			Conversation targetConversation,
			User messageSender,
			MessageStatus status) {
		Message created = new Message();
		created.setId(UUID.randomUUID());
		created.setConversationId(targetConversation.getId());
		created.setSenderId(messageSender.getId());
		created.setContent("Status test");
		created.setStatus(status);
		created.setClientTimestamp(Instant.now());
		Message saved = messageRepository.saveAndFlush(created);
		messageIds.add(saved.getId());
		return saved;
	}

	private void setStatus(UUID messageId, String status) {
		jdbcTemplate.update(
				"UPDATE messages SET status = ? WHERE id = ?",
				status,
				messageId);
	}

	private String loadStatus(UUID messageId) {
		return jdbcTemplate.queryForObject(
				"SELECT status FROM messages WHERE id = ?",
				String.class,
				messageId);
	}

	private Instant loadUpdatedAt(UUID messageId) {
		Timestamp timestamp = jdbcTemplate.queryForObject(
				"SELECT updated_at FROM messages WHERE id = ?",
				Timestamp.class,
				messageId);
		return timestamp.toInstant();
	}

	private Instant loadConversationUpdatedAt(UUID conversationId) {
		Timestamp timestamp = jdbcTemplate.queryForObject(
				"SELECT updated_at FROM conversations WHERE id = ?",
				Timestamp.class,
				conversationId);
		return timestamp.toInstant();
	}

	private String tokenFor(User user) {
		return jwtService.generateAccessToken(user.getId(), user.getRole());
	}

	private String path(UUID conversationId, UUID messageId) {
		return "/conversations/" + conversationId + "/messages/" + messageId;
	}

	private org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder authenticatedPut(
			String path,
			String token,
			String status) {
		return put(path)
				.header("Authorization", "Bearer " + token)
				.contentType("application/json")
				.content("{\"status\":\"" + status + "\"}");
	}
}
