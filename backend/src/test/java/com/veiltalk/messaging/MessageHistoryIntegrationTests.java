package com.veiltalk.messaging;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.time.Instant;
import java.util.HashSet;
import java.util.Set;
import java.util.UUID;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
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
class MessageHistoryIntegrationTests {

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

	private User requester;
	private User otherUser;
	private User outsider;
	private Conversation conversation;
	private String requesterToken;

	@BeforeEach
	void createFixture() {
		requester = createUser("history-requester");
		otherUser = createUser("history-other");
		outsider = createUser("history-outsider");
		conversation = createConversation(requester, otherUser);
		requesterToken = tokenFor(requester);
	}

	@Test
	void tc26ReturnsNewestPageAscendingAndLoadsOlderPageWithoutDuplicates() throws Exception {
		Instant base = Instant.parse("2026-07-25T10:00:00Z");
		for (int index = 0; index < 50; index++) {
			createMessage("message-" + index, base.plusSeconds(index), false);
		}

		JsonNode newestPage = responseJson(
				mockMvc.perform(authenticatedGet(path("?limit=20"), requesterToken))
						.andExpect(status().isOk())
						.andExpect(jsonPath("$.data.length()").value(20))
						.andExpect(jsonPath("$.data[0].content").value("message-30"))
						.andExpect(jsonPath("$.data[19].content").value("message-49"))
						.andExpect(jsonPath("$.has_more").value(true))
						.andExpect(jsonPath("$.prev_cursor").isNotEmpty())
						.andReturn().getResponse().getContentAsString());

		String cursor = newestPage.get("prev_cursor").asText();
		JsonNode olderPage = responseJson(
				mockMvc.perform(authenticatedGet(
								path("?limit=20&cursor=" + cursor),
								requesterToken))
						.andExpect(status().isOk())
						.andExpect(jsonPath("$.data.length()").value(20))
						.andExpect(jsonPath("$.data[0].content").value("message-10"))
						.andExpect(jsonPath("$.data[19].content").value("message-29"))
						.andExpect(jsonPath("$.has_more").value(true))
						.andReturn().getResponse().getContentAsString());

		Set<String> ids = new HashSet<>();
		newestPage.get("data").forEach(message -> ids.add(message.get("id").asText()));
		olderPage.get("data").forEach(message -> ids.add(message.get("id").asText()));
		assertThat(ids).hasSize(40);
	}

	@Test
	void usesMessageIdAsTieBreakerAndExcludesSoftDeletedMessages() throws Exception {
		Instant timestamp = Instant.parse("2026-07-25T10:00:00Z");
		for (int index = 0; index < 3; index++) {
			createMessage("visible-" + index, timestamp, false);
		}
		createMessage("deleted", timestamp.plusSeconds(1), true);

		JsonNode firstPage = responseJson(
				mockMvc.perform(authenticatedGet(path("?limit=2"), requesterToken))
						.andExpect(status().isOk())
						.andExpect(jsonPath("$.data.length()").value(2))
						.andExpect(jsonPath("$.has_more").value(true))
						.andReturn().getResponse().getContentAsString());
		JsonNode secondPage = responseJson(
				mockMvc.perform(authenticatedGet(
								path("?limit=2&cursor=" + firstPage.get("prev_cursor").asText()),
								requesterToken))
						.andExpect(status().isOk())
						.andExpect(jsonPath("$.data.length()").value(1))
						.andExpect(jsonPath("$.has_more").value(false))
						.andReturn().getResponse().getContentAsString());

		Set<String> contents = new HashSet<>();
		firstPage.get("data").forEach(message -> contents.add(message.get("content").asText()));
		secondPage.get("data").forEach(message -> contents.add(message.get("content").asText()));
		assertThat(contents).containsExactlyInAnyOrder("visible-0", "visible-1", "visible-2");
	}

	@Test
	void validatesCursorAndLimit() throws Exception {
		for (String query : new String[] {
				"?cursor=invalid",
				"?limit=0",
				"?limit=101",
				"?limit=not-a-number"
		}) {
			mockMvc.perform(authenticatedGet(path(query), requesterToken))
					.andExpect(status().isBadRequest())
					.andExpect(jsonPath("$.error.code").value("VALIDATION_ERROR"));
		}
	}

	@Test
	void enforcesAuthenticationMembershipAndActiveConversation() throws Exception {
		mockMvc.perform(get(path("")))
				.andExpect(status().isUnauthorized());
		mockMvc.perform(authenticatedGet(path(""), tokenFor(outsider)))
				.andExpect(status().isForbidden())
				.andExpect(jsonPath("$.error.code").value("FORBIDDEN"));
		mockMvc.perform(authenticatedGet(
						"/conversations/" + UUID.randomUUID() + "/messages",
						requesterToken))
				.andExpect(status().isNotFound())
				.andExpect(jsonPath("$.error.code").value("NOT_FOUND"));

		conversation.setDeletedAt(Instant.now());
		conversationRepository.saveAndFlush(conversation);
		mockMvc.perform(authenticatedGet(path(""), requesterToken))
				.andExpect(status().isNotFound());
	}

	private User createUser(String prefix) {
		User user = new User();
		user.setEmail(prefix + "-" + UUID.randomUUID() + "@example.com");
		user.setPasswordHash("test-only-hash");
		user.setDisplayName(prefix);
		return userRepository.saveAndFlush(user);
	}

	private Conversation createConversation(User first, User second) {
		Conversation created = new Conversation();
		UUID userAId = first.getId().toString().compareTo(second.getId().toString()) < 0
				? first.getId()
				: second.getId();
		created.setUserAId(userAId);
		created.setUserBId(userAId.equals(first.getId()) ? second.getId() : first.getId());
		return conversationRepository.saveAndFlush(created);
	}

	private void createMessage(String content, Instant clientTimestamp, boolean deleted) {
		Message message = new Message();
		message.setId(UUID.randomUUID());
		message.setConversationId(conversation.getId());
		message.setSenderId(requester.getId());
		message.setContent(content);
		message.setClientTimestamp(clientTimestamp);
		if (deleted) {
			message.setDeletedAt(Instant.now());
		}
		messageRepository.saveAndFlush(message);
	}

	private String tokenFor(User user) {
		return jwtService.generateAccessToken(user.getId(), user.getRole());
	}

	private String path(String query) {
		return "/conversations/" + conversation.getId() + "/messages" + query;
	}

	private org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder authenticatedGet(
			String path,
			String token) {
		return get(path).header("Authorization", "Bearer " + token);
	}

	private JsonNode responseJson(String responseBody) throws Exception {
		return objectMapper.readTree(responseBody);
	}
}
