package com.veiltalk.messaging;

import static org.assertj.core.api.Assertions.assertThat;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.WebSocket;
import java.time.Duration;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.CompletionStage;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.data.redis.core.StringRedisTemplate;

import com.veiltalk.auth.JwtBlacklistService;
import com.veiltalk.auth.JwtClaims;
import com.veiltalk.auth.JwtService;
import com.veiltalk.auth.User;
import com.veiltalk.auth.UserRepository;

@SpringBootTest(
		webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT,
		properties = {
				"messaging.websocket.heartbeat-interval-ms=100",
				"jwt.access-expiry=2"
		})
class MessagingWebSocketLifecycleIntegrationTests {

	@LocalServerPort
	private int port;

	@Autowired
	private JwtService jwtService;

	@Autowired
	private JwtBlacklistService jwtBlacklistService;

	@Autowired
	private UserRepository userRepository;

	@Autowired
	private StringRedisTemplate redisTemplate;

	@Autowired
	private WebSocketSessionRegistry sessionRegistry;

	private final List<WebSocket> sockets = new CopyOnWriteArrayList<>();
	private final List<UUID> blacklistKeys = new ArrayList<>();
	private User user;

	@BeforeEach
	void createUser() {
		User newUser = new User();
		newUser.setEmail("messaging-ws-lifecycle-" + UUID.randomUUID() + "@example.com");
		newUser.setPasswordHash("not-used-by-lifecycle-test");
		newUser.setDisplayName("Messaging WS lifecycle");
		user = userRepository.saveAndFlush(newUser);
	}

	@AfterEach
	void cleanUp() throws Exception {
		for (WebSocket socket : sockets) {
			if (!socket.isOutputClosed()) {
				try {
					socket.sendClose(WebSocket.NORMAL_CLOSURE, "test cleanup").join();
				}
				catch (RuntimeException exception) {
					// Socket đã bị server đóng bằng 4002/4003; không còn tài nguyên client cần giữ.
				}
			}
		}
		awaitConnectionCount(0, Duration.ofSeconds(2));
		for (UUID jwtId : blacklistKeys) {
			redisTemplate.delete("jwt:blacklist:" + jwtId);
		}
		redisTemplate.delete("jwt:user-revoked-after:" + user.getId());
		userRepository.deleteById(user.getId());
		userRepository.flush();
	}

	@Test
	void tc46PingPongKeepsConnectionAlive() throws Exception {
		RecordingListener listener = new RecordingListener(true);
		connect(listener);

		assertThat(listener.firstPing.await(1, TimeUnit.SECONDS)).isTrue();
		Thread.sleep(350);

		assertThat(listener.pingCount.get()).isGreaterThanOrEqualTo(3);
		assertThat(listener.closed.getCount()).isEqualTo(1);
		assertThat(sessionRegistry.connectionCount(user.getId())).isEqualTo(1);
	}

	@Test
	void tc61TwoUnansweredPingsClose4003() throws Exception {
		RecordingListener listener = new RecordingListener(false);
		connect(listener);

		assertThat(listener.closed.await(2, TimeUnit.SECONDS)).isTrue();
		assertThat(listener.closeCode.get()).isEqualTo(4003);
		awaitConnectionCount(0, Duration.ofSeconds(1));
	}

	@Test
	void tc62BlacklistDuringSessionCloses4002() throws Exception {
		RecordingListener listener = new RecordingListener(true);
		String token = jwtService.generateAccessToken(user.getId(), user.getRole());
		connect(token, listener);
		assertThat(listener.firstPing.await(1, TimeUnit.SECONDS)).isTrue();
		JwtClaims claims = jwtService.extractClaims(token);
		blacklistKeys.add(claims.jwtId());

		jwtBlacklistService.blacklist(claims.jwtId(), Duration.ofMinutes(1));

		assertThat(listener.closed.await(2, TimeUnit.SECONDS)).isTrue();
		assertThat(listener.closeCode.get()).isEqualTo(4002);
		awaitConnectionCount(0, Duration.ofSeconds(1));
	}

	@Test
	void tc62TokenExpiryTimerCloses4002() throws Exception {
		RecordingListener listener = new RecordingListener(true);
		connect(listener);

		assertThat(listener.closed.await(4, TimeUnit.SECONDS)).isTrue();
		assertThat(listener.closeCode.get()).isEqualTo(4002);
		awaitConnectionCount(0, Duration.ofSeconds(1));
	}

	@Test
	void tc63ClosingOneTabKeepsOtherSessionRegistered() throws Exception {
		RecordingListener firstListener = new RecordingListener(true);
		RecordingListener secondListener = new RecordingListener(true);
		WebSocket first = connect(firstListener);
		WebSocket second = connect(secondListener);
		awaitConnectionCount(2, Duration.ofSeconds(1));

		first.sendClose(WebSocket.NORMAL_CLOSURE, "close first tab").join();
		assertThat(firstListener.closed.await(1, TimeUnit.SECONDS)).isTrue();
		awaitConnectionCount(1, Duration.ofSeconds(1));

		assertThat(secondListener.closed.getCount()).isEqualTo(1);
		assertThat(second.isOutputClosed()).isFalse();
	}

	private WebSocket connect(RecordingListener listener) {
		return connect(jwtService.generateAccessToken(user.getId(), user.getRole()), listener);
	}

	private WebSocket connect(String token, RecordingListener listener) {
		WebSocket socket = HttpClient.newHttpClient()
				.newWebSocketBuilder()
				.buildAsync(
						URI.create("ws://localhost:" + port + "/ws/messaging?token=" + token),
						listener)
				.orTimeout(5, TimeUnit.SECONDS)
				.join();
		sockets.add(socket);
		return socket;
	}

	private void awaitConnectionCount(int expected, Duration timeout) throws Exception {
		long deadline = System.nanoTime() + timeout.toNanos();
		while (System.nanoTime() < deadline) {
			if (sessionRegistry.connectionCount(user.getId()) == expected) {
				return;
			}
			Thread.sleep(10);
		}
		assertThat(sessionRegistry.connectionCount(user.getId())).isEqualTo(expected);
	}

	private static final class RecordingListener implements WebSocket.Listener {

		private final boolean autoPong;
		private final StringBuilder partialMessage = new StringBuilder();
		private final CountDownLatch firstPing = new CountDownLatch(1);
		private final CountDownLatch closed = new CountDownLatch(1);
		private final AtomicInteger pingCount = new AtomicInteger();
		private final AtomicInteger closeCode = new AtomicInteger();

		private RecordingListener(boolean autoPong) {
			this.autoPong = autoPong;
		}

		@Override
		public void onOpen(WebSocket webSocket) {
			webSocket.request(1);
		}

		@Override
		public CompletionStage<?> onText(WebSocket webSocket, CharSequence data, boolean last) {
			partialMessage.append(data);
			if (last) {
				String message = partialMessage.toString();
				partialMessage.setLength(0);
				if ("{\"type\":\"PING\"}".equals(message)) {
					pingCount.incrementAndGet();
					firstPing.countDown();
					if (autoPong) {
						webSocket.sendText("{\"type\":\"PONG\"}", true);
					}
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
	}
}
