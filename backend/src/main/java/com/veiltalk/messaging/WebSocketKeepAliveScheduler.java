package com.veiltalk.messaging;

import java.io.IOException;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.UUID;
import java.util.concurrent.ScheduledFuture;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.scheduling.TaskScheduler;
import org.springframework.stereotype.Component;
import org.springframework.web.socket.CloseStatus;
import org.springframework.web.socket.TextMessage;

import com.veiltalk.auth.JwtBlacklistService;
import com.veiltalk.auth.UserTokenRevocationService;
import com.veiltalk.messaging.WebSocketSessionRegistry.SessionState;

import io.micrometer.core.instrument.Counter;
import io.micrometer.core.instrument.MeterRegistry;

@Component
public class WebSocketKeepAliveScheduler {

	static final CloseStatus TOKEN_EXPIRED_OR_REVOKED =
			new CloseStatus(4002, "Access token expired or revoked");
	static final CloseStatus HEARTBEAT_TIMEOUT =
			new CloseStatus(4003, "Heartbeat timeout");

	private static final Logger LOGGER = LoggerFactory.getLogger(WebSocketKeepAliveScheduler.class);
	private static final TextMessage PING_MESSAGE = new TextMessage("{\"type\":\"PING\"}");
	private static final int MAX_UNANSWERED_PINGS = 2;
	private static final String AUTH_RECHECK_FAILURE_METRIC =
			"messaging.websocket.auth.recheck.failures";

	private final WebSocketSessionRegistry sessionRegistry;
	private final JwtBlacklistService jwtBlacklistService;
	private final UserTokenRevocationService userTokenRevocationService;
	private final TaskScheduler taskScheduler;
	private final Clock clock;
	private final Duration heartbeatInterval;
	private final Counter authRecheckFailureCounter;

	public WebSocketKeepAliveScheduler(
			WebSocketSessionRegistry sessionRegistry,
			JwtBlacklistService jwtBlacklistService,
			UserTokenRevocationService userTokenRevocationService,
			@Qualifier("messagingWebSocketTaskScheduler") TaskScheduler taskScheduler,
			Clock clock,
			MeterRegistry meterRegistry,
			@Value("${messaging.websocket.heartbeat-interval-ms}") long heartbeatIntervalMillis) {
		if (heartbeatIntervalMillis <= 0) {
			throw new IllegalArgumentException("Messaging WebSocket heartbeat interval must be positive");
		}
		this.sessionRegistry = sessionRegistry;
		this.jwtBlacklistService = jwtBlacklistService;
		this.userTokenRevocationService = userTokenRevocationService;
		this.taskScheduler = taskScheduler;
		this.clock = clock;
		this.heartbeatInterval = Duration.ofMillis(heartbeatIntervalMillis);
		this.authRecheckFailureCounter = meterRegistry.counter(AUTH_RECHECK_FAILURE_METRIC);
	}

	void start(SessionState state) {
		Instant expiresAt = requiredInstant(
				state,
				WebSocketAuthHandshakeInterceptor.JWT_EXPIRES_AT_ATTRIBUTE);
		if (!expiresAt.isAfter(clock.instant())) {
			terminate(state, TOKEN_EXPIRED_OR_REVOKED);
			return;
		}

		ScheduledFuture<?> heartbeatTask = taskScheduler.scheduleAtFixedRate(
				() -> heartbeat(state),
				clock.instant().plus(heartbeatInterval),
				heartbeatInterval);
		state.attachHeartbeatTask(heartbeatTask);

		ScheduledFuture<?> expiryTask = taskScheduler.schedule(
				() -> terminate(state, TOKEN_EXPIRED_OR_REVOKED),
				expiresAt);
		state.attachExpiryTask(expiryTask);

		sendPing(state);
	}

	void pongReceived(SessionState state) {
		if (state != null && state.isActive()) {
			state.pongReceived();
		}
	}

	void terminate(SessionState state, CloseStatus closeStatus) {
		if (!sessionRegistry.remove(state)) {
			return;
		}
		try {
			if (state.session().isOpen()) {
				state.session().close(closeStatus);
			}
		}
		catch (IOException exception) {
			LOGGER.warn(
					"Could not close Messaging WebSocket session {} with code {}",
					state.session().getId(),
					closeStatus.getCode(),
					exception);
		}
	}

	private void heartbeat(SessionState state) {
		if (!state.isActive()) {
			return;
		}
		if (tokenWasRevoked(state)) {
			terminate(state, TOKEN_EXPIRED_OR_REVOKED);
			return;
		}
		if (state.unansweredPings() >= MAX_UNANSWERED_PINGS) {
			terminate(state, HEARTBEAT_TIMEOUT);
			return;
		}
		sendPing(state);
	}

	private boolean tokenWasRevoked(SessionState state) {
		UUID jwtId = requiredUuid(
				state,
				WebSocketAuthHandshakeInterceptor.JWT_ID_ATTRIBUTE);
		UUID userId = state.userId();
		Instant issuedAt = requiredInstant(
				state,
				WebSocketAuthHandshakeInterceptor.JWT_ISSUED_AT_ATTRIBUTE);
		try {
			return jwtBlacklistService.isBlacklisted(jwtId)
					|| userTokenRevocationService.isRevoked(userId, issuedAt);
		}
		catch (RuntimeException exception) {
			authRecheckFailureCounter.increment();
			LOGGER.error(
					"Messaging WebSocket token re-check failed for user {}; keeping session until next heartbeat",
					userId,
					exception);
			return false;
		}
	}

	private void sendPing(SessionState state) {
		if (!state.isActive()) {
			return;
		}
		try {
			state.session().sendMessage(PING_MESSAGE);
			state.pingSent();
		}
		catch (IOException | RuntimeException exception) {
			LOGGER.warn(
					"Messaging WebSocket PING failed for session {}",
					state.session().getId(),
					exception);
			terminate(state, CloseStatus.SERVER_ERROR);
		}
	}

	private UUID requiredUuid(SessionState state, String attributeName) {
		Object value = state.session().getAttributes().get(attributeName);
		if (value instanceof UUID uuid) {
			return uuid;
		}
		throw new IllegalStateException("Missing Messaging WebSocket UUID attribute: " + attributeName);
	}

	private Instant requiredInstant(SessionState state, String attributeName) {
		Object value = state.session().getAttributes().get(attributeName);
		if (value instanceof Instant instant) {
			return instant;
		}
		throw new IllegalStateException("Missing Messaging WebSocket timestamp attribute: " + attributeName);
	}
}
