package com.veiltalk.messaging;

import java.io.IOException;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ScheduledFuture;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicReference;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;
import org.springframework.web.socket.CloseStatus;
import org.springframework.web.socket.WebSocketSession;
import org.springframework.web.socket.handler.ConcurrentWebSocketSessionDecorator;

import jakarta.annotation.PreDestroy;

@Component
public class WebSocketSessionRegistry {

	private static final Logger LOGGER = LoggerFactory.getLogger(WebSocketSessionRegistry.class);

	private final ConcurrentHashMap<UUID, ConcurrentHashMap<String, SessionState>> sessionsByUser =
			new ConcurrentHashMap<>();
	private final int sendTimeLimitMillis;
	private final int sendBufferSizeBytes;

	public WebSocketSessionRegistry(
			@Value("${messaging.websocket.send-time-limit-ms}") int sendTimeLimitMillis,
			@Value("${messaging.websocket.send-buffer-size-bytes}") int sendBufferSizeBytes) {
		if (sendTimeLimitMillis <= 0 || sendBufferSizeBytes <= 0) {
			throw new IllegalArgumentException("Messaging WebSocket send limits must be positive");
		}
		this.sendTimeLimitMillis = sendTimeLimitMillis;
		this.sendBufferSizeBytes = sendBufferSizeBytes;
	}

	SessionState register(UUID userId, WebSocketSession session) {
		if (userId == null || session == null) {
			throw new IllegalArgumentException("User ID and WebSocket session are required");
		}
		WebSocketSession concurrentSession = new ConcurrentWebSocketSessionDecorator(
				session,
				sendTimeLimitMillis,
				sendBufferSizeBytes);
		SessionState state = new SessionState(userId, concurrentSession);
		SessionState replaced = sessionsByUser
				.computeIfAbsent(userId, ignored -> new ConcurrentHashMap<>())
				.put(session.getId(), state);
		if (replaced != null) {
			replaced.deactivate();
		}
		return state;
	}

	SessionState find(UUID userId, String sessionId) {
		ConcurrentHashMap<String, SessionState> userSessions = sessionsByUser.get(userId);
		return userSessions == null ? null : userSessions.get(sessionId);
	}

	boolean remove(SessionState state) {
		if (state == null) {
			return false;
		}
		ConcurrentHashMap<String, SessionState> userSessions = sessionsByUser.get(state.userId());
		if (userSessions == null || !userSessions.remove(state.session().getId(), state)) {
			return false;
		}
		state.deactivate();
		if (userSessions.isEmpty()) {
			sessionsByUser.remove(state.userId(), userSessions);
		}
		return true;
	}

	SessionState remove(UUID userId, String sessionId) {
		ConcurrentHashMap<String, SessionState> userSessions = sessionsByUser.get(userId);
		if (userSessions == null) {
			return null;
		}
		SessionState removed = userSessions.remove(sessionId);
		if (removed != null) {
			removed.deactivate();
		}
		if (userSessions.isEmpty()) {
			sessionsByUser.remove(userId, userSessions);
		}
		return removed;
	}

	List<SessionState> sessionsForUser(UUID userId) {
		ConcurrentHashMap<String, SessionState> userSessions = sessionsByUser.get(userId);
		return userSessions == null ? List.of() : List.copyOf(userSessions.values());
	}

	List<SessionState> allSessions() {
		return sessionsByUser.values().stream()
				.flatMap(userSessions -> userSessions.values().stream())
				.toList();
	}

	int connectionCount(UUID userId) {
		ConcurrentHashMap<String, SessionState> userSessions = sessionsByUser.get(userId);
		return userSessions == null ? 0 : userSessions.size();
	}

	@PreDestroy
	void closeAllOnShutdown() {
		for (SessionState state : allSessions()) {
			if (!remove(state)) {
				continue;
			}
			try {
				if (state.session().isOpen()) {
					state.session().close(CloseStatus.GOING_AWAY);
				}
			}
			catch (IOException exception) {
				LOGGER.warn(
						"Could not close Messaging WebSocket session {} during shutdown",
						state.session().getId(),
						exception);
			}
		}
	}

	static final class SessionState {

		private final UUID userId;
		private final WebSocketSession session;
		private final AtomicInteger unansweredPings = new AtomicInteger();
		private final AtomicInteger contractViolations = new AtomicInteger();
		private final AtomicBoolean active = new AtomicBoolean(true);
		private final AtomicReference<ScheduledFuture<?>> heartbeatTask = new AtomicReference<>();
		private final AtomicReference<ScheduledFuture<?>> expiryTask = new AtomicReference<>();

		private SessionState(UUID userId, WebSocketSession session) {
			this.userId = userId;
			this.session = session;
		}

		UUID userId() {
			return userId;
		}

		WebSocketSession session() {
			return session;
		}

		int unansweredPings() {
			return unansweredPings.get();
		}

		void pingSent() {
			unansweredPings.incrementAndGet();
		}

		void pongReceived() {
			unansweredPings.set(0);
		}

		int recordContractViolation() {
			return contractViolations.incrementAndGet();
		}

		boolean isActive() {
			return active.get();
		}

		void attachHeartbeatTask(ScheduledFuture<?> task) {
			attachTask(heartbeatTask, task);
		}

		void attachExpiryTask(ScheduledFuture<?> task) {
			attachTask(expiryTask, task);
		}

		void deactivate() {
			if (!active.compareAndSet(true, false)) {
				return;
			}
			cancel(heartbeatTask.getAndSet(null));
			cancel(expiryTask.getAndSet(null));
		}

		private void attachTask(
				AtomicReference<ScheduledFuture<?>> taskReference,
				ScheduledFuture<?> task) {
			if (task == null) {
				throw new IllegalStateException("TaskScheduler did not return a scheduled task");
			}
			ScheduledFuture<?> previous = taskReference.getAndSet(task);
			cancel(previous);
			if (!active.get() && taskReference.compareAndSet(task, null)) {
				cancel(task);
			}
		}

		private void cancel(ScheduledFuture<?> task) {
			if (task != null) {
				task.cancel(false);
			}
		}
	}
}
