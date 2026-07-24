package com.veiltalk.messaging;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatCode;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import java.time.Instant;
import java.util.UUID;

import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.data.redis.core.StringRedisTemplate;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;

import io.micrometer.core.instrument.Counter;
import io.micrometer.core.instrument.MeterRegistry;

class MessageRealtimePublisherTests {

	@Test
	void publishesDocumentedChannelAndPayloadContract() throws Exception {
		StringRedisTemplate redisTemplate = mock(StringRedisTemplate.class);
		ObjectMapper objectMapper = new ObjectMapper().findAndRegisterModules();
		MeterRegistry meterRegistry = mock(MeterRegistry.class);
		Counter failureCounter = mock(Counter.class);
		when(meterRegistry.counter("messaging.redis.publish.failures")).thenReturn(failureCounter);
		MessageRealtimePublisher publisher = new MessageRealtimePublisher(
				redisTemplate,
				objectMapper,
				meterRegistry);
		UUID recipientUserId = UUID.randomUUID();
		MessageResponse message = sampleMessage();
		ArgumentCaptor<String> payloadCaptor = ArgumentCaptor.forClass(String.class);

		publisher.publishNewMessage(recipientUserId, message);

		verify(redisTemplate).convertAndSend(
				org.mockito.ArgumentMatchers.eq("messaging:user:" + recipientUserId),
				payloadCaptor.capture());
		JsonNode payload = objectMapper.readTree(payloadCaptor.getValue());
		assertThat(payload.get("type").asText()).isEqualTo("NEW_MESSAGE");
		assertThat(payload.get("data").get("id").asText()).isEqualTo(message.id().toString());
		assertThat(payload.get("data").get("conversation_id").asText())
				.isEqualTo(message.conversationId().toString());
		assertThat(payload.get("data").get("sender_id").asText())
				.isEqualTo(message.senderId().toString());
		assertThat(payload.get("data").get("content").asText()).isEqualTo(message.content());
	}

	@Test
	void redisFailureIsBestEffortAndIncrementsMetric() throws Exception {
		StringRedisTemplate redisTemplate = mock(StringRedisTemplate.class);
		ObjectMapper objectMapper = mock(ObjectMapper.class);
		MeterRegistry meterRegistry = mock(MeterRegistry.class);
		Counter failureCounter = mock(Counter.class);
		MessageResponse message = sampleMessage();
		UUID recipientUserId = UUID.randomUUID();
		when(objectMapper.writeValueAsString(org.mockito.ArgumentMatchers.any()))
				.thenReturn("{\"type\":\"NEW_MESSAGE\"}");
		when(redisTemplate.convertAndSend(
				"messaging:user:" + recipientUserId,
				"{\"type\":\"NEW_MESSAGE\"}"))
				.thenThrow(new IllegalStateException("Redis unavailable"));
		when(meterRegistry.counter("messaging.redis.publish.failures")).thenReturn(failureCounter);
		MessageRealtimePublisher publisher = new MessageRealtimePublisher(
				redisTemplate,
				objectMapper,
				meterRegistry);

		assertThatCode(() -> publisher.publishNewMessage(recipientUserId, message))
				.doesNotThrowAnyException();
		verify(failureCounter).increment();
	}

	private MessageResponse sampleMessage() {
		return new MessageResponse(
				UUID.randomUUID(),
				UUID.randomUUID(),
				UUID.randomUUID(),
				"Xin chào!",
				"sent",
				Instant.now(),
				Instant.now());
	}
}
