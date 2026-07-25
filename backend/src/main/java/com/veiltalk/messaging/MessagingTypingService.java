package com.veiltalk.messaging;

import java.util.UUID;

import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class MessagingTypingService {

	private final ConversationRepository conversationRepository;
	private final MessageRealtimePublisher realtimePublisher;

	public MessagingTypingService(
			ConversationRepository conversationRepository,
			MessageRealtimePublisher realtimePublisher) {
		this.conversationRepository = conversationRepository;
		this.realtimePublisher = realtimePublisher;
	}

	@Transactional(readOnly = true)
	public boolean relay(UUID senderUserId, String type, UUID conversationId) {
		Conversation conversation = conversationRepository
				.findByIdAndDeletedAtIsNull(conversationId)
				.orElse(null);
		if (conversation == null || !isMember(conversation, senderUserId)) {
			return false;
		}
		UUID recipientUserId = conversation.getUserAId().equals(senderUserId)
				? conversation.getUserBId()
				: conversation.getUserAId();
		realtimePublisher.publishTyping(recipientUserId, type, conversationId);
		return true;
	}

	private boolean isMember(Conversation conversation, UUID userId) {
		return conversation.getUserAId().equals(userId)
				|| conversation.getUserBId().equals(userId);
	}
}
