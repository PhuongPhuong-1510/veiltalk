package com.veiltalk.messaging;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.util.Map;
import java.util.UUID;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.boot.actuate.health.Status;
import org.springframework.data.redis.connection.Message;
import org.springframework.web.socket.TextMessage;
import org.springframework.web.socket.WebSocketSession;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.veiltalk.messaging.WebSocketSessionRegistry.SessionState;

import io.micrometer.core.instrument.simple.SimpleMeterRegistry;

class MessagingRedisSubscriberTests {

	private WebSocketSessionRegistry sessionRegistry;
	private WebSocketKeepAliveScheduler keepAliveScheduler;
	private MessagingRedisSubscriberHealthIndicator healthIndicator;
	private SimpleMeterRegistry meterRegistry;
	private MessagingRedisSubscriber subscriber;

	@BeforeEach
	void setUp() {
		sessionRegistry = new WebSocketSessionRegistry(10_000, 262_144);
		keepAliveScheduler = mock(WebSocketKeepAliveScheduler.class);
		healthIndicator = new MessagingRedisSubscriberHealthIndicator();
		meterRegistry = new SimpleMeterRegistry();
		subscriber = new MessagingRedisSubscriber(
				sessionRegistry,
				keepAliveScheduler,
				healthIndicator,
				new ObjectMapper(),
				meterRegistry);
	}

	@Test
	void validEventFansOutOriginalEnvelopeToEveryLocalSession() throws Exception {
		UUID userId = UUID.randomUUID();
		WebSocketSession first = openSession("first");
		WebSocketSession second = openSession("second");
		sessionRegistry.register(userId, first);
		sessionRegistry.register(userId, second);
		String payload = """
				{"type":"NEW_MESSAGE","data":{"id":"%s","content":"Xin chào"}}
				""".formatted(UUID.randomUUID()).trim();

		subscriber.onMessage(redisMessage(userId, payload), null);

		verify(first).sendMessage(new TextMessage(payload));
		verify(second).sendMessage(new TextMessage(payload));
		assertThat(healthIndicator.health().getStatus()).isEqualTo(Status.UP);
	}

	@Test
	void callIncomingEnvelopeIsReadyForFuturePublisher() throws Exception {
		UUID userId = UUID.randomUUID();
		WebSocketSession session = openSession("call");
		sessionRegistry.register(userId, session);
		String payload = """
				{"type":"CALL_INCOMING","data":{"caller_id":"%s","call_session_id":"%s"}}
				""".formatted(UUID.randomUUID(), UUID.randomUUID()).trim();

		subscriber.onMessage(redisMessage(userId, payload), null);

		verify(session).sendMessage(new TextMessage(payload));
	}

	@Test
	void malformedEventDegradesHealthWithoutClosingSocket() throws Exception {
		UUID userId = UUID.randomUUID();
		WebSocketSession session = openSession("malformed");
		sessionRegistry.register(userId, session);

		subscriber.onMessage(redisMessage(userId, "{\"type\":\"UNKNOWN\",\"data\":{}}"), null);

		verify(session, never()).sendMessage(any());
		verify(keepAliveScheduler, never()).terminate(any(), any());
		assertThat(sessionRegistry.connectionCount(userId)).isEqualTo(1);
		assertThat(healthIndicator.health().getStatus().getCode()).isEqualTo("DEGRADED");
		assertThat(meterRegistry.counter("messaging.redis.subscribe.failures").count())
				.isEqualTo(1);
	}

	@Test
	void containerFailureDegradesHealthAndKeepsSessionsConnected() {
		UUID userId = UUID.randomUUID();
		sessionRegistry.register(userId, openSession("container-error"));

		subscriber.handleContainerError(new IllegalStateException("Redis unavailable"));

		assertThat(sessionRegistry.connectionCount(userId)).isEqualTo(1);
		assertThat(healthIndicator.health().getStatus().getCode()).isEqualTo("DEGRADED");
		assertThat(meterRegistry.counter("messaging.redis.subscribe.failures").count())
				.isEqualTo(1);
	}

	@Test
	void sendFailureOnlyTerminatesBrokenSessionAndContinuesFanOut() throws Exception {
		UUID userId = UUID.randomUUID();
		WebSocketSession broken = openSession("broken");
		WebSocketSession healthy = openSession("healthy");
		SessionState brokenState = sessionRegistry.register(userId, broken);
		sessionRegistry.register(userId, healthy);
		String payload = "{\"type\":\"MESSAGE_STATUS_UPDATE\",\"data\":{\"id\":\""
				+ UUID.randomUUID() + "\",\"status\":\"read\"}}";
		org.mockito.Mockito.doThrow(new IOException("closed"))
				.when(broken)
				.sendMessage(any());

		subscriber.onMessage(redisMessage(userId, payload), null);

		verify(keepAliveScheduler).terminate(
				org.mockito.ArgumentMatchers.eq(brokenState),
				org.mockito.ArgumentMatchers.argThat(status -> status.getCode() == 1011));
		verify(healthy).sendMessage(new TextMessage(payload));
		assertThat(meterRegistry.counter("messaging.websocket.delivery.failures").count())
				.isEqualTo(1);
	}

	private WebSocketSession openSession(String id) {
		WebSocketSession session = mock(WebSocketSession.class);
		when(session.getId()).thenReturn(id);
		when(session.isOpen()).thenReturn(true);
		when(session.getAttributes()).thenReturn(Map.of());
		return session;
	}

	private Message redisMessage(UUID userId, String payload) {
		Message message = mock(Message.class);
		when(message.getChannel()).thenReturn(
				("messaging:user:" + userId).getBytes(StandardCharsets.UTF_8));
		when(message.getBody()).thenReturn(payload.getBytes(StandardCharsets.UTF_8));
		return message;
	}
}
