package com.veiltalk.messaging;

import java.util.UUID;

import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import com.veiltalk.auth.NotFoundException;
import com.veiltalk.auth.UnauthorizedException;
import com.veiltalk.auth.User;
import com.veiltalk.auth.UserRepository;
import com.veiltalk.auth.ValidationException;

@Service
public class ConversationService {

	private static final String INVALID_SESSION_MESSAGE = "Invalid session";
	private static final String USER_NOT_FOUND_MESSAGE = "User not found";
	private static final String SELF_CONVERSATION_MESSAGE = "Cannot create a conversation with yourself";

	private final ConversationRepository conversationRepository;
	private final UserRepository userRepository;

	public ConversationService(
			ConversationRepository conversationRepository,
			UserRepository userRepository) {
		this.conversationRepository = conversationRepository;
		this.userRepository = userRepository;
	}

	@Transactional
	public CreateResult createOrGet(UUID authenticatedUserId, CreateConversationRequest request) {
		requireActiveUser(authenticatedUserId);
		UUID otherUserId = request.otherUserId();
		if (authenticatedUserId.equals(otherUserId)) {
			throw new ValidationException(SELF_CONVERSATION_MESSAGE);
		}
		User otherUser = userRepository.findByIdAndDeletedAtIsNull(otherUserId)
				.orElseThrow(() -> new NotFoundException(USER_NOT_FOUND_MESSAGE));

		ConversationPair pair = normalizePair(authenticatedUserId, otherUserId);
		UUID conversationId = UUID.randomUUID();
		boolean created = conversationRepository.insertIfAbsent(
				conversationId,
				pair.userAId(),
				pair.userBId()) == 1;
		Conversation conversation = conversationRepository.findActivePair(
				pair.userAId(),
				pair.userBId())
				.orElseThrow(() -> new IllegalStateException("Conversation was not persisted"));

		return new CreateResult(toResponse(conversation, otherUser), created);
	}

	private void requireActiveUser(UUID authenticatedUserId) {
		if (userRepository.findByIdAndDeletedAtIsNull(authenticatedUserId).isEmpty()) {
			throw new UnauthorizedException(INVALID_SESSION_MESSAGE);
		}
	}

	private ConversationPair normalizePair(UUID firstUserId, UUID secondUserId) {
		if (firstUserId.toString().compareTo(secondUserId.toString()) < 0) {
			return new ConversationPair(firstUserId, secondUserId);
		}
		return new ConversationPair(secondUserId, firstUserId);
	}

	private ConversationResponse toResponse(Conversation conversation, User otherUser) {
		return new ConversationResponse(
				conversation.getId(),
				new ConversationResponse.OtherUserResponse(
						otherUser.getId(),
						otherUser.getDisplayName(),
						otherUser.getAvatarUrl()),
				conversation.getCreatedAt(),
				conversation.getUpdatedAt());
	}

	private record ConversationPair(UUID userAId, UUID userBId) {
	}

	public record CreateResult(ConversationResponse response, boolean created) {
	}
}
