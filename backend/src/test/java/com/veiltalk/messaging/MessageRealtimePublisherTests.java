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

	@Test
	void publishesStatusUpdateContract() throws Exception {
		StringRedisTemplate redisTemplate = mock(StringRedisTemplate.class);
		ObjectMapper objectMapper = new ObjectMapper().findAndRegisterModules();
		MeterRegistry meterRegistry = mock(MeterRegistry.class);
		Counter failureCounter = mock(Counter.class);
		when(meterRegistry.counter("messaging.redis.publish.failures")).thenReturn(failureCounter);
		MessageRealtimePublisher publisher = new MessageRealtimePublisher(
				redisTemplate,
				objectMapper,
				meterRegistry);
		UUID userId = UUID.randomUUID();
		MessageStatusResponse status = new MessageStatusResponse(
				UUID.randomUUID(),
				"read",
				Instant.now());
		ArgumentCaptor<String> payloadCaptor = ArgumentCaptor.forClass(String.class);

		publisher.publishStatusUpdate(userId, status);

		verify(redisTemplate).convertAndSend(
				org.mockito.ArgumentMatchers.eq("messaging:user:" + userId),
				payloadCaptor.capture());
		JsonNode payload = objectMapper.readTree(payloadCaptor.getValue());
		assertThat(payload.get("type").asText()).isEqualTo("MESSAGE_STATUS_UPDATE");
		assertThat(payload.get("data").get("id").asText()).isEqualTo(status.id().toString());
		assertThat(payload.get("data").get("status").asText()).isEqualTo("read");
		assertThat(payload.get("data").has("updated_at")).isFalse();
	}

	@Test
	void statusPublishFailureIsBestEffortAndIncrementsMetric() throws Exception {
		StringRedisTemplate redisTemplate = mock(StringRedisTemplate.class);
		ObjectMapper objectMapper = mock(ObjectMapper.class);
		MeterRegistry meterRegistry = mock(MeterRegistry.class);
		Counter failureCounter = mock(Counter.class);
		UUID userId = UUID.randomUUID();
		MessageStatusResponse status = new MessageStatusResponse(
				UUID.randomUUID(),
				"read",
				Instant.now());
		when(objectMapper.writeValueAsString(org.mockito.ArgumentMatchers.any()))
				.thenReturn("{\"type\":\"MESSAGE_STATUS_UPDATE\"}");
		when(redisTemplate.convertAndSend(
				"messaging:user:" + userId,
				"{\"type\":\"MESSAGE_STATUS_UPDATE\"}"))
				.thenThrow(new IllegalStateException("Redis unavailable"));
		when(meterRegistry.counter("messaging.redis.publish.failures")).thenReturn(failureCounter);
		MessageRealtimePublisher publisher = new MessageRealtimePublisher(
				redisTemplate,
				objectMapper,
				meterRegistry);

		assertThatCode(() -> publisher.publishStatusUpdate(userId, status))
				.doesNotThrowAnyException();
		verify(failureCounter).increment();
	}

	@Test
	void publishesTypingContractsWithoutChangingExistingEvents() throws Exception {
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
		UUID conversationId = UUID.randomUUID();
		ArgumentCaptor<String> payloadCaptor = ArgumentCaptor.forClass(String.class);

		publisher.publishTyping(recipientUserId, "TYPING", conversationId);
		publisher.publishTyping(recipientUserId, "TYPING_STOP", conversationId);

		verify(redisTemplate, org.mockito.Mockito.times(2)).convertAndSend(
				org.mockito.ArgumentMatchers.eq("messaging:user:" + recipientUserId),
				payloadCaptor.capture());
		assertThat(payloadCaptor.getAllValues()).extracting(payload -> {
			try {
				return objectMapper.readTree(payload).path("type").asText();
			}
			catch (Exception exception) {
				throw new IllegalStateException(exception);
			}
		}).containsExactly("TYPING", "TYPING_STOP");
		for (String payload : payloadCaptor.getAllValues()) {
			JsonNode event = objectMapper.readTree(payload);
			assertThat(event.path("data").path("conversation_id").asText())
					.isEqualTo(conversationId.toString());
		}
	}

	@Test
	void publishesCallIncomingContract() throws Exception {
		StringRedisTemplate redisTemplate = mock(StringRedisTemplate.class);
		ObjectMapper objectMapper = new ObjectMapper().findAndRegisterModules();
		MeterRegistry meterRegistry = mock(MeterRegistry.class);
		Counter failureCounter = mock(Counter.class);
		when(meterRegistry.counter("messaging.redis.publish.failures")).thenReturn(failureCounter);
		MessageRealtimePublisher publisher = new MessageRealtimePublisher(
				redisTemplate,
				objectMapper,
				meterRegistry);
		UUID calleeUserId = UUID.randomUUID();
		UUID callerId = UUID.randomUUID();
		UUID callSessionId = UUID.randomUUID();
		ArgumentCaptor<String> payloadCaptor = ArgumentCaptor.forClass(String.class);

		publisher.publishCallIncoming(calleeUserId, callerId, "Nguyễn Văn A", callSessionId);

		verify(redisTemplate).convertAndSend(
				org.mockito.ArgumentMatchers.eq("messaging:user:" + calleeUserId),
				payloadCaptor.capture());
		JsonNode payload = objectMapper.readTree(payloadCaptor.getValue());
		assertThat(payload.get("type").asText()).isEqualTo("CALL_INCOMING");
		assertThat(payload.get("data").get("caller_id").asText()).isEqualTo(callerId.toString());
		assertThat(payload.get("data").get("caller_display_name").asText()).isEqualTo("Nguyễn Văn A");
		assertThat(payload.get("data").get("call_session_id").asText()).isEqualTo(callSessionId.toString());
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
