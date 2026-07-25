package com.veiltalk.messaging;

import java.util.UUID;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;
import org.springframework.web.socket.CloseStatus;
import org.springframework.web.socket.TextMessage;
import org.springframework.web.socket.WebSocketSession;
import org.springframework.web.socket.handler.TextWebSocketHandler;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.veiltalk.messaging.WebSocketSessionRegistry.SessionState;

@Component
public class MessagingWebSocketHandler extends TextWebSocketHandler {

	private static final Logger LOGGER = LoggerFactory.getLogger(MessagingWebSocketHandler.class);
	private static final String PONG_EVENT = "PONG";
	private static final String TYPING_EVENT = "TYPING";
	private static final String TYPING_STOP_EVENT = "TYPING_STOP";
	private static final int MAX_CONTRACT_VIOLATIONS = 3;

	private final WebSocketSessionRegistry sessionRegistry;
	private final WebSocketKeepAliveScheduler keepAliveScheduler;
	private final MessagingTypingService typingService;
	private final ObjectMapper objectMapper;

	public MessagingWebSocketHandler(
			WebSocketSessionRegistry sessionRegistry,
			WebSocketKeepAliveScheduler keepAliveScheduler,
			MessagingTypingService typingService,
			ObjectMapper objectMapper) {
		this.sessionRegistry = sessionRegistry;
		this.keepAliveScheduler = keepAliveScheduler;
		this.typingService = typingService;
		this.objectMapper = objectMapper;
	}

	@Override
	public void afterConnectionEstablished(WebSocketSession session) {
		UUID userId = authenticatedUserId(session);
		if (userId == null) {
			closeUnusableSession(session);
			return;
		}
		SessionState state = sessionRegistry.register(userId, session);
		keepAliveScheduler.start(state);
	}

	@Override
	protected void handleTextMessage(WebSocketSession session, TextMessage message) {
		SessionState state = sessionState(session);
		if (state == null) {
			closeUnusableSession(session);
			return;
		}

		JsonNode event;
		try {
			event = objectMapper.readTree(message.getPayload());
		}
		catch (Exception exception) {
			reject(state, "VALIDATION_ERROR", "Invalid WebSocket event payload");
			return;
		}
		if (event == null || !event.isObject() || !event.path("type").isTextual()) {
			reject(state, "VALIDATION_ERROR", "Invalid WebSocket event payload");
			return;
		}

		String type = event.path("type").asText();
		if (PONG_EVENT.equals(type)) {
			keepAliveScheduler.pongReceived(state);
			return;
		}
		if (TYPING_EVENT.equals(type) || TYPING_STOP_EVENT.equals(type)) {
			handleTyping(state, event, type);
			return;
		}
		reject(state, "UNSUPPORTED_EVENT", "Unsupported WebSocket event type");
	}

	@Override
	public void handleTransportError(WebSocketSession session, Throwable exception) {
		LOGGER.warn("Messaging WebSocket transport error for session {}", session.getId(), exception);
		UUID userId = authenticatedUserId(session);
		SessionState state = userId == null ? null : sessionRegistry.find(userId, session.getId());
		if (state != null) {
			keepAliveScheduler.terminate(state, CloseStatus.SERVER_ERROR);
		}
		else {
			closeUnusableSession(session);
		}
	}

	@Override
	public void afterConnectionClosed(WebSocketSession session, CloseStatus status) {
		removeSession(session);
	}

	private SessionState removeSession(WebSocketSession session) {
		UUID userId = authenticatedUserId(session);
		return userId == null ? null : sessionRegistry.remove(userId, session.getId());
	}

	private SessionState sessionState(WebSocketSession session) {
		UUID userId = authenticatedUserId(session);
		return userId == null ? null : sessionRegistry.find(userId, session.getId());
	}

	private void handleTyping(SessionState state, JsonNode event, String type) {
		JsonNode conversationIdNode = event.path("data").path("conversation_id");
		if (!event.path("data").isObject() || !conversationIdNode.isTextual()) {
			reject(state, "VALIDATION_ERROR", "data.conversation_id must be a UUID");
			return;
		}

		UUID conversationId;
		try {
			conversationId = UUID.fromString(conversationIdNode.asText());
		}
		catch (IllegalArgumentException exception) {
			reject(state, "VALIDATION_ERROR", "data.conversation_id must be a UUID");
			return;
		}

		try {
			if (!typingService.relay(state.userId(), type, conversationId)) {
				reject(
						state,
						"FORBIDDEN",
						"Typing is not allowed for this conversation");
			}
		}
		catch (RuntimeException exception) {
			LOGGER.error(
					"Messaging WebSocket typing relay failed for user {} session {}",
					state.userId(),
					state.session().getId(),
					exception);
			keepAliveScheduler.terminate(state, CloseStatus.SERVER_ERROR);
		}
	}

	private void reject(SessionState state, String code, String message) {
		int violationCount = state.recordContractViolation();
		try {
			String payload = objectMapper.writeValueAsString(
					new ErrorEvent("ERROR", new ErrorData(code, message)));
			state.session().sendMessage(new TextMessage(payload));
		}
		catch (Exception exception) {
			LOGGER.warn(
					"Could not send Messaging WebSocket ERROR to session {}",
					state.session().getId(),
					exception);
			keepAliveScheduler.terminate(state, CloseStatus.SERVER_ERROR);
			return;
		}
		if (violationCount >= MAX_CONTRACT_VIOLATIONS) {
			keepAliveScheduler.terminate(state, CloseStatus.POLICY_VIOLATION);
		}
	}

	private UUID authenticatedUserId(WebSocketSession session) {
		Object userId = session.getAttributes().get(
				WebSocketAuthHandshakeInterceptor.USER_ID_ATTRIBUTE);
		return userId instanceof UUID uuid ? uuid : null;
	}

	private void closeUnusableSession(WebSocketSession session) {
		try {
			if (session.isOpen()) {
				session.close(CloseStatus.SERVER_ERROR);
			}
		}
		catch (Exception exception) {
			LOGGER.warn("Could not close unusable Messaging WebSocket session {}", session.getId(), exception);
		}
	}

	private record ErrorEvent(String type, ErrorData data) {
	}

	private record ErrorData(String code, String message) {
	}
}
