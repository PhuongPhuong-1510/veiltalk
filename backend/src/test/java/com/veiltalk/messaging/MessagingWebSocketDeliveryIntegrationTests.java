package com.veiltalk.messaging;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.WebSocket;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.BlockingQueue;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.CompletionStage;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.concurrent.LinkedBlockingQueue;
import java.util.concurrent.TimeUnit;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.actuate.health.Status;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.web.servlet.MockMvc;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.veiltalk.auth.JwtService;
import com.veiltalk.auth.User;
import com.veiltalk.auth.UserRepository;

@SpringBootTest(
		webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT,
		properties = "messaging.websocket.heartbeat-interval-ms=100")
@AutoConfigureMockMvc
class MessagingWebSocketDeliveryIntegrationTests {

	@LocalServerPort
	private int port;

	@Autowired
	private MockMvc mockMvc;

	@Autowired
	private ObjectMapper objectMapper;

	@Autowired
	private JwtService jwtService;

	@Autowired
	private UserRepository userRepository;

	@Autowired
	private ConversationRepository conversationRepository;

	@Autowired
	private MessageRepository messageRepository;

	@Autowired
	private JdbcTemplate jdbcTemplate;

	@Autowired
	private StringRedisTemplate redisTemplate;

	@Autowired
	private WebSocketSessionRegistry sessionRegistry;

	@Autowired
	private MessagingRedisSubscriber redisSubscriber;

	@Autowired
	private MessagingRedisSubscriberHealthIndicator subscriberHealth;

	private final List<WebSocket> sockets = new CopyOnWriteArrayList<>();
	private final List<UUID> messageIds = new ArrayList<>();
	private final List<UUID> conversationIds = new ArrayList<>();
	private final List<UUID> userIds = new ArrayList<>();

	private User sender;
	private User recipient;
	private Conversation conversation;

	@BeforeEach
	void createFixture() {
		sender = createUser("delivery-sender");
		recipient = createUser("delivery-recipient");
		conversation = createConversation(sender, recipient);
	}

	@AfterEach
	void cleanUp() throws Exception {
		for (WebSocket socket : sockets) {
			if (!socket.isOutputClosed()) {
				try {
					socket.sendClose(WebSocket.NORMAL_CLOSURE, "test cleanup").join();
				}
				catch (RuntimeException exception) {
					// Socket đã đóng; không còn tài nguyên client cần giữ.
				}
			}
		}
		awaitConnectionCount(sender.getId(), 0, Duration.ofSeconds(2));
		awaitConnectionCount(recipient.getId(), 0, Duration.ofSeconds(2));
		messageIds.forEach(id -> jdbcTemplate.update("DELETE FROM messages WHERE id = ?", id));
		conversationIds.forEach(
				id -> jdbcTemplate.update("DELETE FROM conversations WHERE id = ?", id));
		userIds.forEach(id -> jdbcTemplate.update("DELETE FROM users WHERE id = ?", id));
	}

	@Test
	void tc64NewMessageReachesEveryRecipientTabWithFullResponseData() throws Exception {
		EventListener senderListener = connect(sender);
		EventListener firstRecipientListener = connect(recipient);
		EventListener secondRecipientListener = connect(recipient);
		awaitConnectionCount(sender.getId(), 1, Duration.ofSeconds(1));
		awaitConnectionCount(recipient.getId(), 2, Duration.ofSeconds(1));
		UUID messageId = trackMessage(UUID.randomUUID());
		String request = objectMapper.writeValueAsString(new CreateRequest(
				messageId,
				"Redis delivery",
				Instant.now()));

		String responseBody = mockMvc.perform(post(
						"/conversations/" + conversation.getId() + "/messages")
						.header("Authorization", "Bearer " + tokenFor(sender))
						.contentType(MediaType.APPLICATION_JSON)
						.content(request))
				.andExpect(status().isCreated())
				.andReturn()
				.getResponse()
				.getContentAsString();
		JsonNode expectedData = objectMapper.readTree(responseBody);

		JsonNode firstEvent = firstRecipientListener.awaitEvent("NEW_MESSAGE");
		JsonNode secondEvent = secondRecipientListener.awaitEvent("NEW_MESSAGE");
		assertThat(firstEvent.path("data")).isEqualTo(expectedData);
		assertThat(secondEvent.path("data")).isEqualTo(expectedData);
		assertThat(senderListener.pollEvent("NEW_MESSAGE", Duration.ofMillis(250))).isNull();
	}

	@Test
	void tc65StatusUpdateReachesSenderAndEveryRecipientTab() throws Exception {
		Message message = createMessage(conversation, sender);
		EventListener senderListener = connect(sender);
		EventListener firstRecipientListener = connect(recipient);
		EventListener secondRecipientListener = connect(recipient);

		mockMvc.perform(put(
						"/conversations/" + conversation.getId() + "/messages/" + message.getId())
						.header("Authorization", "Bearer " + tokenFor(recipient))
						.contentType(MediaType.APPLICATION_JSON)
						.content("{\"status\":\"read\"}"))
				.andExpect(status().isOk());

		for (EventListener listener : List.of(
				senderListener,
				firstRecipientListener,
				secondRecipientListener)) {
			JsonNode event = listener.awaitEvent("MESSAGE_STATUS_UPDATE");
			assertThat(event.path("data").path("id").asText())
					.isEqualTo(message.getId().toString());
			assertThat(event.path("data").path("status").asText()).isEqualTo("read");
			assertThat(event.path("data").size()).isEqualTo(2);
		}
	}

	@Test
	void tc66SubscriberFailureKeepsSocketAndNextRedisEventRestoresHealth() throws Exception {
		EventListener listener = connect(recipient);
		awaitConnectionCount(recipient.getId(), 1, Duration.ofSeconds(1));

		redisSubscriber.handleContainerError(new IllegalStateException("simulated outage"));

		assertThat(subscriberHealth.health().getStatus().getCode()).isEqualTo("DEGRADED");
		assertThat(sessionRegistry.connectionCount(recipient.getId())).isEqualTo(1);
		String payload = """
				{"type":"CALL_INCOMING","data":{"caller_id":"%s","caller_display_name":"Sender","call_session_id":"%s"}}
				""".formatted(sender.getId(), UUID.randomUUID()).trim();
		redisTemplate.convertAndSend("messaging:user:" + recipient.getId(), payload);

		assertThat(listener.awaitEvent("CALL_INCOMING").toString()).isEqualTo(payload);
		assertThat(subscriberHealth.health().getStatus()).isEqualTo(Status.UP);
		assertThat(sessionRegistry.connectionCount(recipient.getId())).isEqualTo(1);
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

	private Message createMessage(Conversation targetConversation, User messageSender) {
		Message message = new Message();
		message.setId(trackMessage(UUID.randomUUID()));
		message.setConversationId(targetConversation.getId());
		message.setSenderId(messageSender.getId());
		message.setContent("Status delivery");
		message.setStatus(MessageStatus.SENT);
		message.setClientTimestamp(Instant.now());
		return messageRepository.saveAndFlush(message);
	}

	private UUID trackMessage(UUID messageId) {
		messageIds.add(messageId);
		return messageId;
	}

	private EventListener connect(User user) {
		EventListener listener = new EventListener(objectMapper);
		WebSocket socket = HttpClient.newHttpClient()
				.newWebSocketBuilder()
				.buildAsync(
						URI.create("ws://localhost:" + port + "/ws/messaging?token=" + tokenFor(user)),
						listener)
				.orTimeout(5, TimeUnit.SECONDS)
				.join();
		sockets.add(socket);
		return listener;
	}

	private String tokenFor(User user) {
		return jwtService.generateAccessToken(user.getId(), user.getRole());
	}

	private void awaitConnectionCount(UUID userId, int expected, Duration timeout) throws Exception {
		long deadline = System.nanoTime() + timeout.toNanos();
		while (System.nanoTime() < deadline) {
			if (sessionRegistry.connectionCount(userId) == expected) {
				return;
			}
			Thread.sleep(10);
		}
		assertThat(sessionRegistry.connectionCount(userId)).isEqualTo(expected);
	}

	private record CreateRequest(
			UUID id,
			String content,
			Instant client_timestamp) {
	}

	private static final class EventListener implements WebSocket.Listener {

		private final ObjectMapper objectMapper;
		private final BlockingQueue<JsonNode> events = new LinkedBlockingQueue<>();
		private final StringBuilder partialMessage = new StringBuilder();

		private EventListener(ObjectMapper objectMapper) {
			this.objectMapper = objectMapper;
		}

		@Override
		public void onOpen(WebSocket webSocket) {
			webSocket.request(1);
		}

		@Override
		public CompletionStage<?> onText(WebSocket webSocket, CharSequence data, boolean last) {
			partialMessage.append(data);
			if (last) {
				String payload = partialMessage.toString();
				partialMessage.setLength(0);
				try {
					JsonNode event = objectMapper.readTree(payload);
					if ("PING".equals(event.path("type").asText())) {
						webSocket.sendText("{\"type\":\"PONG\"}", true);
					}
					else {
						events.add(event);
					}
				}
				catch (Exception exception) {
					throw new IllegalStateException("Invalid server WebSocket event", exception);
				}
			}
			webSocket.request(1);
			return CompletableFuture.completedFuture(null);
		}

		private JsonNode awaitEvent(String type) throws Exception {
			JsonNode event = pollEvent(type, Duration.ofSeconds(3));
			assertThat(event).as("WebSocket event " + type).isNotNull();
			return event;
		}

		private JsonNode pollEvent(String type, Duration timeout) throws Exception {
			long deadline = System.nanoTime() + timeout.toNanos();
			while (System.nanoTime() < deadline) {
				long remaining = deadline - System.nanoTime();
				JsonNode event = events.poll(
						Math.max(1, TimeUnit.NANOSECONDS.toMillis(remaining)),
						TimeUnit.MILLISECONDS);
				if (event == null || type.equals(event.path("type").asText())) {
					return event;
				}
			}
			return null;
		}
	}
}
