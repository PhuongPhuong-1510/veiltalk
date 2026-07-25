package com.veiltalk.messaging;

import static org.assertj.core.api.Assertions.assertThat;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.WebSocket;
import java.sql.Timestamp;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.BlockingQueue;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.CompletionStage;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.LinkedBlockingQueue;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.jdbc.core.JdbcTemplate;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.veiltalk.auth.JwtService;
import com.veiltalk.auth.User;
import com.veiltalk.auth.UserRepository;

@SpringBootTest(
		webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT,
		properties = "messaging.websocket.heartbeat-interval-ms=100")
class MessagingWebSocketTypingIntegrationTests {

	@LocalServerPort
	private int port;

	@Autowired
	private ObjectMapper objectMapper;

	@Autowired
	private JwtService jwtService;

	@Autowired
	private UserRepository userRepository;

	@Autowired
	private ConversationRepository conversationRepository;

	@Autowired
	private JdbcTemplate jdbcTemplate;

	@Autowired
	private WebSocketSessionRegistry sessionRegistry;

	private final List<WebSocket> sockets = new CopyOnWriteArrayList<>();
	private final List<UUID> conversationIds = new ArrayList<>();
	private final List<UUID> userIds = new ArrayList<>();

	private User sender;
	private User recipient;
	private User outsider;
	private Conversation conversation;

	@BeforeEach
	void createFixture() {
		sender = createUser("typing-sender");
		recipient = createUser("typing-recipient");
		outsider = createUser("typing-outsider");
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
					// Socket đã bị server đóng bởi test close-code.
				}
			}
		}
		for (UUID userId : userIds) {
			awaitConnectionCount(userId, 0, Duration.ofSeconds(2));
		}
		conversationIds.forEach(
				id -> jdbcTemplate.update("DELETE FROM conversations WHERE id = ?", id));
		userIds.forEach(id -> jdbcTemplate.update("DELETE FROM users WHERE id = ?", id));
	}

	@Test
	void tc50TypingAndTypingStopRelayOnlyToRecipientWithin500Millis() throws Exception {
		Connection senderConnection = connect(sender);
		Connection recipientConnection = connect(recipient);
		Instant conversationUpdatedAt = conversationUpdatedAt();
		String typing = typingPayload("TYPING", conversation.getId().toString());

		long startedAt = System.nanoTime();
		senderConnection.socket().sendText(typing, true).join();
		JsonNode typingEvent = recipientConnection.listener().awaitEvent("TYPING");
		long elapsedMillis = TimeUnit.NANOSECONDS.toMillis(System.nanoTime() - startedAt);

		assertThat(elapsedMillis).isLessThan(500);
		assertThat(typingEvent.path("data").path("conversation_id").asText())
				.isEqualTo(conversation.getId().toString());
		assertThat(senderConnection.listener().pollEvent(
				"TYPING",
				Duration.ofMillis(250))).isNull();

		senderConnection.socket().sendText(
				typingPayload("TYPING_STOP", conversation.getId().toString()),
				true).join();
		JsonNode stopEvent = recipientConnection.listener().awaitEvent("TYPING_STOP");
		assertThat(stopEvent.path("data").path("conversation_id").asText())
				.isEqualTo(conversation.getId().toString());
		assertThat(conversationUpdatedAt()).isEqualTo(conversationUpdatedAt);
	}

	@Test
	void forbiddenResponseDoesNotRevealMissingDeletedOrNonMemberConversation() throws Exception {
		Connection senderConnection = connect(sender);
		Connection outsiderConnection = connect(outsider);

		outsiderConnection.socket().sendText(
				typingPayload("TYPING", conversation.getId().toString()),
				true).join();
		JsonNode nonMemberError = outsiderConnection.listener().awaitEvent("ERROR");

		senderConnection.socket().sendText(
				typingPayload("TYPING", UUID.randomUUID().toString()),
				true).join();
		JsonNode missingError = senderConnection.listener().awaitEvent("ERROR");

		jdbcTemplate.update(
				"UPDATE conversations SET deleted_at = NOW() WHERE id = ?",
				conversation.getId());
		senderConnection.socket().sendText(
				typingPayload("TYPING", conversation.getId().toString()),
				true).join();
		JsonNode deletedError = senderConnection.listener().awaitEvent("ERROR");

		for (JsonNode error : List.of(nonMemberError, missingError, deletedError)) {
			assertThat(error.path("data").path("code").asText()).isEqualTo("FORBIDDEN");
			assertThat(error.path("data").path("message").asText())
					.isEqualTo("Typing is not allowed for this conversation");
		}
	}

	@Test
	void tc67ThreeContractViolationsSendErrorsThenClose1008() throws Exception {
		Connection connection = connect(sender);

		connection.socket().sendText("not-json", true).join();
		JsonNode malformedError = connection.listener().awaitEvent("ERROR");
		assertThat(malformedError.path("data").path("code").asText())
				.isEqualTo("VALIDATION_ERROR");

		connection.socket().sendText("{\"type\":\"UNKNOWN\"}", true).join();
		JsonNode unsupportedError = connection.listener().awaitEvent("ERROR");
		assertThat(unsupportedError.path("data").path("code").asText())
				.isEqualTo("UNSUPPORTED_EVENT");

		connection.socket().sendText(
				typingPayload("TYPING", "not-a-uuid"),
				true).join();
		JsonNode invalidTypingError = connection.listener().awaitEvent("ERROR");
		assertThat(invalidTypingError.path("data").path("code").asText())
				.isEqualTo("VALIDATION_ERROR");
		assertThat(connection.listener().closed.await(2, TimeUnit.SECONDS)).isTrue();
		assertThat(connection.listener().closeCode.get()).isEqualTo(1008);
	}

	@Test
	void tc68TextFrameOver32KiBCloses1009() throws Exception {
		Connection connection = connect(sender);
		String oversizedPayload = "{\"type\":\"UNKNOWN\",\"padding\":\""
				+ "x".repeat(33_000)
				+ "\"}";

		connection.socket().sendText(oversizedPayload, true).join();

		assertThat(connection.listener().closed.await(2, TimeUnit.SECONDS)).isTrue();
		assertThat(connection.listener().closeCode.get()).isEqualTo(1009);
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

	private Instant conversationUpdatedAt() {
		return jdbcTemplate.queryForObject(
				"SELECT updated_at FROM conversations WHERE id = ?",
				Timestamp.class,
				conversation.getId()).toInstant();
	}

	private Connection connect(User user) {
		EventListener listener = new EventListener(objectMapper);
		WebSocket socket = HttpClient.newHttpClient()
				.newWebSocketBuilder()
				.buildAsync(
						URI.create("ws://localhost:" + port + "/ws/messaging?token="
								+ jwtService.generateAccessToken(user.getId(), user.getRole())),
						listener)
				.orTimeout(5, TimeUnit.SECONDS)
				.join();
		sockets.add(socket);
		return new Connection(socket, listener);
	}

	private String typingPayload(String type, String conversationId) {
		return "{\"type\":\"" + type + "\",\"data\":{\"conversation_id\":\""
				+ conversationId + "\"}}";
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

	private record Connection(WebSocket socket, EventListener listener) {
	}

	private static final class EventListener implements WebSocket.Listener {

		private final ObjectMapper objectMapper;
		private final BlockingQueue<JsonNode> events = new LinkedBlockingQueue<>();
		private final StringBuilder partialMessage = new StringBuilder();
		private final CountDownLatch closed = new CountDownLatch(1);
		private final AtomicInteger closeCode = new AtomicInteger();

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

		@Override
		public CompletionStage<?> onClose(WebSocket webSocket, int statusCode, String reason) {
			closeCode.set(statusCode);
			closed.countDown();
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
