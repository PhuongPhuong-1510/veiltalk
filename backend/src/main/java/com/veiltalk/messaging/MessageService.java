package com.veiltalk.messaging;

import java.time.Duration;
import java.time.Instant;
import java.util.UUID;

import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.support.TransactionSynchronization;
import org.springframework.transaction.support.TransactionSynchronizationManager;

import com.veiltalk.auth.ConflictException;
import com.veiltalk.auth.ForbiddenException;
import com.veiltalk.auth.NotFoundException;
import com.veiltalk.auth.UnauthorizedException;
import com.veiltalk.auth.UserRepository;
import com.veiltalk.auth.ValidationException;

@Service
public class MessageService {

	private static final Duration MAX_CLIENT_CLOCK_SKEW = Duration.ofMinutes(5);
	private static final String INVALID_SESSION_MESSAGE = "Invalid session";
	private static final String CONVERSATION_NOT_FOUND_MESSAGE = "Conversation not found";
	private static final String CONVERSATION_FORBIDDEN_MESSAGE =
			"You are not a member of this conversation";
	private static final String INVALID_TIMESTAMP_MESSAGE =
			"client_timestamp must be within 5 minutes of server time";
	private static final String MESSAGE_ID_CONFLICT_MESSAGE =
			"Message id already belongs to another sender or conversation";

	private final ConversationRepository conversationRepository;
	private final MessageRepository messageRepository;
	private final UserRepository userRepository;
	private final MessageRealtimePublisher realtimePublisher;

	public MessageService(
			ConversationRepository conversationRepository,
			MessageRepository messageRepository,
			UserRepository userRepository,
			MessageRealtimePublisher realtimePublisher) {
		this.conversationRepository = conversationRepository;
		this.messageRepository = messageRepository;
		this.userRepository = userRepository;
		this.realtimePublisher = realtimePublisher;
	}

	@Transactional
	public CreateResult create(
			UUID authenticatedUserId,
			UUID conversationId,
			CreateMessageRequest request) {
		requireActiveUser(authenticatedUserId);
		Conversation conversation = conversationRepository.findByIdAndDeletedAtIsNull(conversationId)
				.orElseThrow(() -> new NotFoundException(CONVERSATION_NOT_FOUND_MESSAGE));
		if (!isMember(conversation, authenticatedUserId)) {
			throw new ForbiddenException(CONVERSATION_FORBIDDEN_MESSAGE);
		}
		Message existingMessage = messageRepository.findById(request.id()).orElse(null);
		if (existingMessage != null) {
			return new CreateResult(
					requireMatchingIdempotencyScope(
							existingMessage,
							conversationId,
							authenticatedUserId),
					false);
		}
		validateTimestamp(request.clientTimestamp());

		boolean created = messageRepository.insertIfAbsent(
				request.id(),
				conversationId,
				authenticatedUserId,
				request.content(),
				request.clientTimestamp()) == 1;
		Message message = messageRepository.findById(request.id())
				.orElseThrow(() -> new IllegalStateException("Message was not persisted"));
		MessageResponse response = requireMatchingIdempotencyScope(
				message,
				conversationId,
				authenticatedUserId);
		if (created) {
			conversationRepository.touchUpdatedAt(conversationId);
			registerAfterCommitPublish(
					recipientUserId(conversation, authenticatedUserId),
					response);
		}
		return new CreateResult(response, created);
	}

	private MessageResponse requireMatchingIdempotencyScope(
			Message message,
			UUID conversationId,
			UUID senderId) {
		if (!message.getConversationId().equals(conversationId)
				|| !message.getSenderId().equals(senderId)) {
			throw new ConflictException(MESSAGE_ID_CONFLICT_MESSAGE);
		}
		return MessageResponse.from(message);
	}

	private void validateTimestamp(Instant clientTimestamp) {
		Duration difference = Duration.between(Instant.now(), clientTimestamp).abs();
		if (difference.compareTo(MAX_CLIENT_CLOCK_SKEW) > 0) {
			throw new ValidationException(INVALID_TIMESTAMP_MESSAGE);
		}
	}

	private void registerAfterCommitPublish(UUID recipientUserId, MessageResponse response) {
		TransactionSynchronizationManager.registerSynchronization(new TransactionSynchronization() {
			@Override
			public void afterCommit() {
				realtimePublisher.publishNewMessage(recipientUserId, response);
			}
		});
	}

	private void requireActiveUser(UUID authenticatedUserId) {
		if (userRepository.findByIdAndDeletedAtIsNull(authenticatedUserId).isEmpty()) {
			throw new UnauthorizedException(INVALID_SESSION_MESSAGE);
		}
	}

	private boolean isMember(Conversation conversation, UUID userId) {
		return conversation.getUserAId().equals(userId)
				|| conversation.getUserBId().equals(userId);
	}

	private UUID recipientUserId(Conversation conversation, UUID senderId) {
		return conversation.getUserAId().equals(senderId)
				? conversation.getUserBId()
				: conversation.getUserAId();
	}

	public record CreateResult(MessageResponse response, boolean created) {
	}
}
