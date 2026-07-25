package com.veiltalk.messaging;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.util.Set;
import java.util.UUID;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.data.redis.connection.Message;
import org.springframework.data.redis.connection.MessageListener;
import org.springframework.stereotype.Component;
import org.springframework.web.socket.CloseStatus;
import org.springframework.web.socket.TextMessage;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.veiltalk.messaging.WebSocketSessionRegistry.SessionState;

import io.micrometer.core.instrument.Counter;
import io.micrometer.core.instrument.MeterRegistry;

@Component
public class MessagingRedisSubscriber implements MessageListener {

	private static final Logger LOGGER = LoggerFactory.getLogger(MessagingRedisSubscriber.class);
	private static final String CHANNEL_PREFIX = "messaging:user:";
	private static final String SUBSCRIBER_FAILURE_METRIC =
			"messaging.redis.subscribe.failures";
	private static final String DELIVERY_FAILURE_METRIC =
			"messaging.websocket.delivery.failures";
	private static final Set<String> SUPPORTED_EVENTS = Set.of(
			"NEW_MESSAGE",
			"MESSAGE_STATUS_UPDATE",
			"CALL_INCOMING",
			"TYPING",
			"TYPING_STOP");

	private final WebSocketSessionRegistry sessionRegistry;
	private final WebSocketKeepAliveScheduler keepAliveScheduler;
	private final MessagingRedisSubscriberHealthIndicator healthIndicator;
	private final ObjectMapper objectMapper;
	private final Counter subscriberFailureCounter;
	private final Counter deliveryFailureCounter;

	public MessagingRedisSubscriber(
			WebSocketSessionRegistry sessionRegistry,
			WebSocketKeepAliveScheduler keepAliveScheduler,
			MessagingRedisSubscriberHealthIndicator healthIndicator,
			ObjectMapper objectMapper,
			MeterRegistry meterRegistry) {
		this.sessionRegistry = sessionRegistry;
		this.keepAliveScheduler = keepAliveScheduler;
		this.healthIndicator = healthIndicator;
		this.objectMapper = objectMapper;
		this.subscriberFailureCounter = meterRegistry.counter(SUBSCRIBER_FAILURE_METRIC);
		this.deliveryFailureCounter = meterRegistry.counter(DELIVERY_FAILURE_METRIC);
	}

	@Override
	public void onMessage(Message message, byte[] pattern) {
		try {
			String channel = new String(message.getChannel(), StandardCharsets.UTF_8);
			UUID recipientUserId = recipientFrom(channel);
			String payload = new String(message.getBody(), StandardCharsets.UTF_8);
			validateEnvelope(payload);
			forwardToLocalSessions(recipientUserId, payload);
			healthIndicator.markHealthy();
		}
		catch (RuntimeException exception) {
			recordSubscriberFailure("invalid Redis realtime event", exception);
		}
	}

	void handleContainerError(Throwable throwable) {
		recordSubscriberFailure("Redis listener container error", throwable);
	}

	void handleConnectionRestored() {
		healthIndicator.markHealthy();
	}

	private UUID recipientFrom(String channel) {
		if (!channel.startsWith(CHANNEL_PREFIX)) {
			throw new IllegalArgumentException("Unexpected Redis realtime channel");
		}
		String userId = channel.substring(CHANNEL_PREFIX.length());
		return UUID.fromString(userId);
	}

	private void validateEnvelope(String payload) {
		try {
			JsonNode event = objectMapper.readTree(payload);
			if (event == null
					|| !event.isObject()
					|| !event.path("type").isTextual()
					|| !SUPPORTED_EVENTS.contains(event.path("type").asText())
					|| !event.path("data").isObject()) {
				throw new IllegalArgumentException("Invalid Redis realtime envelope");
			}
		}
		catch (IOException exception) {
			throw new IllegalArgumentException("Invalid Redis realtime JSON", exception);
		}
	}

	private void forwardToLocalSessions(UUID recipientUserId, String payload) {
		TextMessage textMessage = new TextMessage(payload);
		for (SessionState state : sessionRegistry.sessionsForUser(recipientUserId)) {
			if (!state.isActive() || !state.session().isOpen()) {
				continue;
			}
			try {
				state.session().sendMessage(textMessage);
			}
			catch (IOException | RuntimeException exception) {
				deliveryFailureCounter.increment();
				LOGGER.warn(
						"Messaging WebSocket delivery failed for user {} session {}",
						recipientUserId,
						state.session().getId(),
						exception);
				keepAliveScheduler.terminate(state, CloseStatus.SERVER_ERROR);
			}
		}
	}

	private void recordSubscriberFailure(String reason, Throwable throwable) {
		subscriberFailureCounter.increment();
		healthIndicator.markDegraded(reason);
		LOGGER.error("{}; WebSocket sessions stay connected and clients recover via history",
				reason,
				throwable);
	}
}
