package com.veiltalk.messaging;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ScheduledFuture;

import org.junit.jupiter.api.Test;
import org.springframework.web.socket.CloseStatus;
import org.springframework.web.socket.TextMessage;
import org.springframework.web.socket.WebSocketSession;
import org.springframework.web.socket.handler.ConcurrentWebSocketSessionDecorator;

import com.veiltalk.messaging.WebSocketSessionRegistry.SessionState;

class WebSocketSessionRegistryTests {

	private static final UUID USER_ID = UUID.fromString("a310fc8c-109f-4e53-91ee-8fcd508f7512");

	@Test
	void keepsMultipleConcurrentSessionsForOneUserAndRemovesOnlyTargetSession() throws Exception {
		WebSocketSessionRegistry registry = new WebSocketSessionRegistry(10_000, 262_144);
		WebSocketSession first = session("first");
		WebSocketSession second = session("second");

		SessionState firstState = registry.register(USER_ID, first);
		SessionState secondState = registry.register(USER_ID, second);

		assertThat(registry.connectionCount(USER_ID)).isEqualTo(2);
		assertThat(registry.sessionsForUser(USER_ID)).containsExactlyInAnyOrder(firstState, secondState);
		assertThat(firstState.session()).isInstanceOf(ConcurrentWebSocketSessionDecorator.class);
		firstState.session().sendMessage(new TextMessage("{\"type\":\"PING\"}"));
		verify(first).sendMessage(new TextMessage("{\"type\":\"PING\"}"));

		registry.remove(firstState);

		assertThat(registry.connectionCount(USER_ID)).isEqualTo(1);
		assertThat(registry.sessionsForUser(USER_ID)).containsExactly(secondState);
		assertThat(firstState.isActive()).isFalse();
		assertThat(secondState.isActive()).isTrue();
	}

	@Test
	void removalCancelsHeartbeatAndExpiryTasks() {
		WebSocketSessionRegistry registry = new WebSocketSessionRegistry(10_000, 262_144);
		SessionState state = registry.register(USER_ID, session("session"));
		ScheduledFuture<?> heartbeatTask = mock(ScheduledFuture.class);
		ScheduledFuture<?> expiryTask = mock(ScheduledFuture.class);
		state.attachHeartbeatTask(heartbeatTask);
		state.attachExpiryTask(expiryTask);

		registry.remove(state);

		verify(heartbeatTask).cancel(false);
		verify(expiryTask).cancel(false);
	}

	@Test
	void shutdownClosesEverySessionWithGoingAway() throws Exception {
		WebSocketSessionRegistry registry = new WebSocketSessionRegistry(10_000, 262_144);
		WebSocketSession first = session("first");
		WebSocketSession second = session("second");
		registry.register(USER_ID, first);
		registry.register(USER_ID, second);

		registry.closeAllOnShutdown();

		verify(first).close(CloseStatus.GOING_AWAY);
		verify(second).close(CloseStatus.GOING_AWAY);
		assertThat(registry.connectionCount(USER_ID)).isZero();
	}

	private WebSocketSession session(String id) {
		WebSocketSession session = mock(WebSocketSession.class);
		when(session.getId()).thenReturn(id);
		when(session.getAttributes()).thenReturn(Map.of());
		when(session.isOpen()).thenReturn(true);
		return session;
	}
}
