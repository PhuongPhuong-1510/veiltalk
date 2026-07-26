package com.veiltalk.call;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.WebSocket;
import java.time.Duration;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.BlockingQueue;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.CompletionStage;
import java.util.concurrent.LinkedBlockingQueue;
import java.util.concurrent.TimeUnit;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.TestPropertySource;
import org.springframework.test.web.servlet.MockMvc;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.veiltalk.auth.User;
import com.veiltalk.auth.UserRepository;
import com.veiltalk.auth.UserRole;

@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
@AutoConfigureMockMvc
@TestPropertySource(properties = "call.notify.secret=call-notify-test-secret")
class CallNotifyIntegrationTests {

	private static final String AUTHORIZATION = "Bearer call-notify-test-secret";

	@LocalServerPort
	private int port;

	@Autowired
	private MockMvc mockMvc;

	@Autowired
	private ObjectMapper objectMapper;

	@Autowired
	private UserRepository userRepository;

	@Autowired
	private JdbcTemplate jdbcTemplate;

	private final List<UUID> userIds = new ArrayList<>();
	private final List<WebSocket> sockets = new ArrayList<>();

	@AfterEach
	void cleanUp() {
		for (WebSocket socket : sockets) {
			if (!socket.isOutputClosed()) {
				try {
					socket.sendClose(WebSocket.NORMAL_CLOSURE, "test cleanup").join();
				}
				catch (RuntimeException exception) {
					// Socket đã đóng.
				}
			}
		}
		userIds.forEach(id -> jdbcTemplate.update("DELETE FROM users WHERE id = ?", id));
	}

	@Test
	void validNotifyPublishesCallIncomingToCalleeMessagingSocket() throws Exception {
		User caller = createUser("call-caller");
		User callee = createUser("call-callee");
		EventListener calleeListener = connect(callee);

		mockMvc.perform(post("/internal/call/notify")
						.header("Authorization", AUTHORIZATION)
						.contentType(MediaType.APPLICATION_JSON)
						.content(notifyBody(caller.getId(), callee.getId())))
				.andExpect(status().isNoContent());

		JsonNode event = calleeListener.awaitEvent("CALL_INCOMING");
		assertThat(event.path("data").path("caller_id").asText()).isEqualTo(caller.getId().toString());
		assertThat(event.path("data").path("caller_display_name").asText())
				.isEqualTo(caller.getDisplayName());
		UUID expectedSessionId = CallSessionIdGenerator.generate(caller.getId(), callee.getId());
		assertThat(event.path("data").path("call_session_id").asText())
				.isEqualTo(expectedSessionId.toString());
	}

	@Test
	void sameCallSessionIdRegardlessOfWhoNotifiesFirst() throws Exception {
		User caller = createUser("call-caller-order");
		User callee = createUser("call-callee-order");
		EventListener calleeListener = connect(callee);
		EventListener callerListener = connect(caller);

		mockMvc.perform(post("/internal/call/notify")
						.header("Authorization", AUTHORIZATION)
						.contentType(MediaType.APPLICATION_JSON)
						.content(notifyBody(caller.getId(), callee.getId())))
				.andExpect(status().isNoContent());
		JsonNode first = calleeListener.awaitEvent("CALL_INCOMING");

		mockMvc.perform(post("/internal/call/notify")
						.header("Authorization", AUTHORIZATION)
						.contentType(MediaType.APPLICATION_JSON)
						.content(notifyBody(callee.getId(), caller.getId())))
				.andExpect(status().isNoContent());
		JsonNode second = callerListener.awaitEvent("CALL_INCOMING");

		assertThat(first.path("data").path("call_session_id").asText())
				.isEqualTo(second.path("data").path("call_session_id").asText());
	}

	@Test
	void missingOrWrongAuthorizationIsRejected() throws Exception {
		User caller = createUser("call-caller-auth");
		User callee = createUser("call-callee-auth");
		String body = notifyBody(caller.getId(), callee.getId());

		mockMvc.perform(post("/internal/call/notify")
						.contentType(MediaType.APPLICATION_JSON)
						.content(body))
				.andExpect(status().isUnauthorized())
				.andExpect(jsonPath("$.error.code").value("UNAUTHORIZED"));

		mockMvc.perform(post("/internal/call/notify")
						.header("Authorization", "Bearer wrong-secret")
						.contentType(MediaType.APPLICATION_JSON)
						.content(body))
				.andExpect(status().isUnauthorized())
				.andExpect(jsonPath("$.error.code").value("UNAUTHORIZED"));
	}

	@Test
	void unknownOrSoftDeletedCalleeReturns404WithoutPublishing() throws Exception {
		User caller = createUser("call-caller-missing");

		mockMvc.perform(post("/internal/call/notify")
						.header("Authorization", AUTHORIZATION)
						.contentType(MediaType.APPLICATION_JSON)
						.content(notifyBody(caller.getId(), UUID.randomUUID())))
				.andExpect(status().isNotFound());
	}

	private User createUser(String prefix) {
		User user = new User();
		user.setEmail(prefix + "-" + UUID.randomUUID() + "@example.com");
		user.setPasswordHash("test-only-hash");
		user.setDisplayName(prefix);
		user.setRole(UserRole.USER);
		User saved = userRepository.saveAndFlush(user);
		userIds.add(saved.getId());
		return saved;
	}

	private String notifyBody(UUID callerId, UUID calleeId) {
		return "{\"caller_id\":\"" + callerId + "\",\"callee_id\":\"" + calleeId + "\"}";
	}

	private EventListener connect(User user) throws Exception {
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

	@Autowired
	private com.veiltalk.auth.JwtService jwtServiceBean;

	private String tokenFor(User user) {
		return jwtServiceBean.generateAccessToken(user.getId(), user.getRole());
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
			long deadline = System.nanoTime() + Duration.ofSeconds(3).toNanos();
			while (System.nanoTime() < deadline) {
				long remaining = deadline - System.nanoTime();
				JsonNode event = events.poll(Math.max(remaining, 0), TimeUnit.NANOSECONDS);
				if (event == null) {
					break;
				}
				if (type.equals(event.path("type").asText())) {
					return event;
				}
			}
			throw new AssertionError("WebSocket event " + type + " not received");
		}
	}
}
