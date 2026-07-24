package com.veiltalk.messaging;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.sql.Timestamp;
import java.time.Instant;
import java.util.UUID;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.transaction.annotation.Transactional;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.veiltalk.auth.JwtService;
import com.veiltalk.auth.User;
import com.veiltalk.auth.UserRepository;

import jakarta.persistence.EntityManager;

@SpringBootTest
@AutoConfigureMockMvc
@Transactional
class ConversationQueryIntegrationTests {

	@Autowired
	private MockMvc mockMvc;

	@Autowired
	private ObjectMapper objectMapper;

	@Autowired
	private UserRepository userRepository;

	@Autowired
	private ConversationRepository conversationRepository;

	@Autowired
	private MessageRepository messageRepository;

	@Autowired
	private JwtService jwtService;

	@Autowired
	private JdbcTemplate jdbcTemplate;

	@Autowired
	private EntityManager entityManager;

	private User requester;
	private User firstOtherUser;
	private User secondOtherUser;
	private User thirdOtherUser;
	private User outsider;
	private String requesterToken;

	@BeforeEach
	void createUsers() {
		requester = createUser("requester");
		firstOtherUser = createUser("first");
		secondOtherUser = createUser("second");
		thirdOtherUser = createUser("third");
		outsider = createUser("outsider");
		requesterToken = tokenFor(requester);
	}

	@Test
	void tc59ListsConversationsInDescendingOrderWithCursor() throws Exception {
		Instant baseTime = Instant.parse("2026-07-25T10:00:00Z");
		Conversation oldest = createConversation(requester, firstOtherUser, baseTime.minusSeconds(120));
		Conversation middle = createConversation(requester, secondOtherUser, baseTime.minusSeconds(60));
		Conversation newest = createConversation(requester, thirdOtherUser, baseTime);
		createMessage(newest, thirdOtherUser, "Newest message", baseTime.plusSeconds(1));
		createMessage(newest, requester, "Older message", baseTime);
		entityManager.clear();

		JsonNode firstPage = responseJson(
				mockMvc.perform(authenticatedGet("/conversations?limit=2", requesterToken))
						.andExpect(status().isOk())
						.andExpect(jsonPath("$.data.length()").value(2))
						.andExpect(jsonPath("$.data[0].id").value(newest.getId().toString()))
						.andExpect(jsonPath("$.data[0].other_user.id")
								.value(thirdOtherUser.getId().toString()))
						.andExpect(jsonPath("$.data[0].last_message.content").value("Newest message"))
						.andExpect(jsonPath("$.data[0].last_message.sender_id")
								.value(thirdOtherUser.getId().toString()))
						.andExpect(jsonPath("$.data[1].id").value(middle.getId().toString()))
						.andExpect(jsonPath("$.has_more").value(true))
						.andExpect(jsonPath("$.next_cursor").isNotEmpty())
						.andReturn().getResponse().getContentAsString());

		String cursor = firstPage.get("next_cursor").asText();
		mockMvc.perform(authenticatedGet(
						"/conversations?limit=2&cursor=" + cursor,
						requesterToken))
				.andExpect(status().isOk())
				.andExpect(jsonPath("$.data.length()").value(1))
				.andExpect(jsonPath("$.data[0].id").value(oldest.getId().toString()))
				.andExpect(jsonPath("$.data[0].last_message").value((Object) null))
				.andExpect(jsonPath("$.has_more").value(false))
				.andExpect(jsonPath("$.next_cursor").value((Object) null));
	}

	@Test
	void tc60ReturnsDetailAndEnforcesMembership() throws Exception {
		Conversation conversation = createConversation(
				requester,
				firstOtherUser,
				Instant.parse("2026-07-25T10:00:00Z"));
		createMessage(
				conversation,
				requester,
				"Detail message",
				Instant.parse("2026-07-25T10:01:00Z"));
		entityManager.clear();

		mockMvc.perform(authenticatedGet(
						"/conversations/" + conversation.getId(),
						requesterToken))
				.andExpect(status().isOk())
				.andExpect(jsonPath("$.id").value(conversation.getId().toString()))
				.andExpect(jsonPath("$.other_user.id").value(firstOtherUser.getId().toString()))
				.andExpect(jsonPath("$.other_user.display_name").value(firstOtherUser.getDisplayName()))
				.andExpect(jsonPath("$.other_user.email").doesNotExist())
				.andExpect(jsonPath("$.last_message.content").value("Detail message"))
				.andExpect(jsonPath("$.created_at").exists())
				.andExpect(jsonPath("$.updated_at").exists());

		mockMvc.perform(authenticatedGet(
						"/conversations/" + conversation.getId(),
						tokenFor(outsider)))
				.andExpect(status().isForbidden())
				.andExpect(jsonPath("$.error.code").value("FORBIDDEN"));

		mockMvc.perform(authenticatedGet(
						"/conversations/" + UUID.randomUUID(),
						requesterToken))
				.andExpect(status().isNotFound())
				.andExpect(jsonPath("$.error.code").value("NOT_FOUND"));
	}

	@Test
	void validatesCursorAndLimit() throws Exception {
		mockMvc.perform(authenticatedGet("/conversations?cursor=invalid", requesterToken))
				.andExpect(status().isBadRequest())
				.andExpect(jsonPath("$.error.code").value("VALIDATION_ERROR"));

		for (String invalidLimit : new String[] {"0", "51", "not-a-number"}) {
			mockMvc.perform(authenticatedGet(
							"/conversations?limit=" + invalidLimit,
							requesterToken))
					.andExpect(status().isBadRequest())
					.andExpect(jsonPath("$.error.code").value("VALIDATION_ERROR"));
		}
	}

	@Test
	void requiresAuthenticationAndActiveSession() throws Exception {
		mockMvc.perform(get("/conversations"))
				.andExpect(status().isUnauthorized());

		requester.setDeletedAt(Instant.now());
		userRepository.saveAndFlush(requester);
		mockMvc.perform(authenticatedGet("/conversations", requesterToken))
				.andExpect(status().isUnauthorized());
	}

	@Test
	void excludesSoftDeletedConversationsAndMessages() throws Exception {
		Conversation visible = createConversation(
				requester,
				firstOtherUser,
				Instant.parse("2026-07-25T10:00:00Z"));
		Conversation deleted = createConversation(
				requester,
				secondOtherUser,
				Instant.parse("2026-07-25T11:00:00Z"));
		deleted.setDeletedAt(Instant.now());
		conversationRepository.saveAndFlush(deleted);
		Message deletedMessage = createMessage(
				visible,
				firstOtherUser,
				"Deleted latest",
				Instant.parse("2026-07-25T10:02:00Z"));
		deletedMessage.setDeletedAt(Instant.now());
		messageRepository.saveAndFlush(deletedMessage);
		createMessage(
				visible,
				requester,
				"Visible older",
				Instant.parse("2026-07-25T10:01:00Z"));
		entityManager.clear();

		mockMvc.perform(authenticatedGet("/conversations", requesterToken))
				.andExpect(status().isOk())
				.andExpect(jsonPath("$.data.length()").value(1))
				.andExpect(jsonPath("$.data[0].id").value(visible.getId().toString()))
				.andExpect(jsonPath("$.data[0].last_message.content").value("Visible older"));
	}

	private User createUser(String prefix) {
		User user = new User();
		user.setEmail(prefix + "-" + UUID.randomUUID() + "@example.com");
		user.setPasswordHash("test-only-hash");
		user.setDisplayName(prefix);
		user.setAvatarUrl("https://cdn.example.com/" + prefix + ".png");
		return userRepository.saveAndFlush(user);
	}

	private Conversation createConversation(User first, User second, Instant updatedAt) {
		UUID userAId = first.getId().toString().compareTo(second.getId().toString()) < 0
				? first.getId()
				: second.getId();
		UUID userBId = userAId.equals(first.getId()) ? second.getId() : first.getId();
		UUID conversationId = UUID.randomUUID();
		assertThat(jdbcTemplate.update(
				"""
						INSERT INTO conversations
							(id, user_a_id, user_b_id, created_at, updated_at)
						VALUES (?, ?, ?, ?, ?)
						""",
				conversationId,
				userAId,
				userBId,
				Timestamp.from(updatedAt),
				Timestamp.from(updatedAt)))
				.isEqualTo(1);
		entityManager.clear();
		return conversationRepository.findById(conversationId).orElseThrow();
	}

	private Message createMessage(
			Conversation conversation,
			User sender,
			String content,
			Instant clientTimestamp) {
		Message message = new Message();
		message.setId(UUID.randomUUID());
		message.setConversationId(conversation.getId());
		message.setSenderId(sender.getId());
		message.setContent(content);
		message.setClientTimestamp(clientTimestamp);
		return messageRepository.saveAndFlush(message);
	}

	private String tokenFor(User user) {
		return jwtService.generateAccessToken(user.getId(), user.getRole());
	}

	private org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder authenticatedGet(
			String path,
			String accessToken) {
		return get(path).header("Authorization", "Bearer " + accessToken);
	}

	private JsonNode responseJson(String responseBody) throws Exception {
		return objectMapper.readTree(responseBody);
	}
}
