package com.veiltalk.messaging;

import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.Base64;
import java.util.UUID;

import org.springframework.stereotype.Component;

import com.fasterxml.jackson.annotation.JsonProperty;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.veiltalk.auth.ValidationException;

@Component
public class ConversationCursorCodec {

	private static final String INVALID_CURSOR_MESSAGE = "Invalid cursor";

	private final ObjectMapper objectMapper;

	public ConversationCursorCodec(ObjectMapper objectMapper) {
		this.objectMapper = objectMapper;
	}

	public String encode(Conversation conversation) {
		try {
			byte[] payload = objectMapper.writeValueAsBytes(
					new CursorPayload(conversation.getId(), conversation.getUpdatedAt().toString()));
			return Base64.getUrlEncoder().withoutPadding().encodeToString(payload);
		} catch (Exception exception) {
			throw new IllegalStateException("Could not encode conversation cursor", exception);
		}
	}

	public Cursor decode(String cursor) {
		try {
			byte[] decoded = Base64.getUrlDecoder().decode(cursor);
			CursorPayload payload = objectMapper.readValue(
					new String(decoded, StandardCharsets.UTF_8),
					CursorPayload.class);
			if (payload.id() == null || payload.timestamp() == null) {
				throw new IllegalArgumentException();
			}
			return new Cursor(Instant.parse(payload.timestamp()), payload.id());
		} catch (Exception exception) {
			throw new ValidationException(INVALID_CURSOR_MESSAGE);
		}
	}

	private record CursorPayload(
			UUID id,
			@JsonProperty("t") String timestamp) {
	}

	public record Cursor(Instant updatedAt, UUID id) {
	}
}
