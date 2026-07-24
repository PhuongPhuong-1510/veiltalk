package com.veiltalk.messaging;

import java.util.UUID;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.stereotype.Component;

import com.fasterxml.jackson.databind.ObjectMapper;

import io.micrometer.core.instrument.MeterRegistry;

@Component
public class MessageRealtimePublisher {

	private static final Logger LOGGER = LoggerFactory.getLogger(MessageRealtimePublisher.class);
	private static final String CHANNEL_PREFIX = "messaging:user:";
	private static final String FAILURE_METRIC = "messaging.redis.publish.failures";

	private final StringRedisTemplate redisTemplate;
	private final ObjectMapper objectMapper;
	private final MeterRegistry meterRegistry;

	public MessageRealtimePublisher(
			StringRedisTemplate redisTemplate,
			ObjectMapper objectMapper,
			MeterRegistry meterRegistry) {
		this.redisTemplate = redisTemplate;
		this.objectMapper = objectMapper;
		this.meterRegistry = meterRegistry;
	}

	public void publishNewMessage(UUID recipientUserId, MessageResponse message) {
		publish(
				recipientUserId,
				"NEW_MESSAGE",
				message,
				message.id());
	}

	public void publishStatusUpdate(UUID userId, MessageStatusResponse status) {
		publish(
				userId,
				"MESSAGE_STATUS_UPDATE",
				new MessageStatusEvent(status.id(), status.status()),
				status.id());
	}

	private void publish(UUID userId, String type, Object data, UUID messageId) {
		try {
			String payload = objectMapper.writeValueAsString(
					new RealtimeEvent(type, data));
			redisTemplate.convertAndSend(CHANNEL_PREFIX + userId, payload);
		} catch (Exception exception) {
			meterRegistry.counter(FAILURE_METRIC).increment();
			LOGGER.error(
					"Realtime message publish failed for message {} and user {}; client must resync from history",
					messageId,
					userId,
					exception);
		}
	}

	private record RealtimeEvent(String type, Object data) {
	}

	private record MessageStatusEvent(UUID id, String status) {
	}
}
