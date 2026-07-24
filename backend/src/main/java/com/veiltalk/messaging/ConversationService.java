package com.veiltalk.messaging;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import org.springframework.data.domain.PageRequest;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import com.veiltalk.auth.ForbiddenException;
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
	private static final String CONVERSATION_NOT_FOUND_MESSAGE = "Conversation not found";
	private static final String CONVERSATION_FORBIDDEN_MESSAGE = "You are not a member of this conversation";
	private static final String INVALID_LIMIT_MESSAGE = "limit must be between 1 and 50";

	private final ConversationRepository conversationRepository;
	private final MessageRepository messageRepository;
	private final UserRepository userRepository;
	private final ConversationCursorCodec cursorCodec;

	public ConversationService(
			ConversationRepository conversationRepository,
			MessageRepository messageRepository,
			UserRepository userRepository,
			ConversationCursorCodec cursorCodec) {
		this.conversationRepository = conversationRepository;
		this.messageRepository = messageRepository;
		this.userRepository = userRepository;
		this.cursorCodec = cursorCodec;
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

	@Transactional(readOnly = true)
	public ConversationListResponse getConversations(
			UUID authenticatedUserId,
			String encodedCursor,
			String requestedLimit) {
		requireActiveUser(authenticatedUserId);
		int limit = parseLimit(requestedLimit);
		PageRequest page = PageRequest.of(0, limit + 1);
		List<Conversation> fetched;
		if (encodedCursor == null) {
			fetched = conversationRepository.findActiveForUser(authenticatedUserId, page);
		} else {
			ConversationCursorCodec.Cursor cursor = cursorCodec.decode(encodedCursor);
			fetched = conversationRepository.findActiveForUserAfter(
					authenticatedUserId,
					cursor.updatedAt(),
					cursor.id(),
					page);
		}

		boolean hasMore = fetched.size() > limit;
		List<Conversation> conversations = hasMore
				? new ArrayList<>(fetched.subList(0, limit))
				: fetched;
		Map<UUID, User> usersById = loadOtherUsers(conversations, authenticatedUserId);
		Map<UUID, ConversationLastMessageResponse> messagesByConversationId =
				loadLastMessages(conversations);
		List<ConversationSummaryResponse> data = conversations.stream()
				.map(conversation -> new ConversationSummaryResponse(
						conversation.getId(),
						toOtherUserResponse(otherUser(conversation, authenticatedUserId, usersById)),
						messagesByConversationId.get(conversation.getId()),
						conversation.getUpdatedAt()))
				.toList();
		String nextCursor = hasMore
				? cursorCodec.encode(conversations.get(conversations.size() - 1))
				: null;
		return new ConversationListResponse(data, nextCursor, hasMore);
	}

	@Transactional(readOnly = true)
	public ConversationDetailResponse getConversation(UUID authenticatedUserId, UUID conversationId) {
		requireActiveUser(authenticatedUserId);
		Conversation conversation = conversationRepository.findByIdAndDeletedAtIsNull(conversationId)
				.orElseThrow(() -> new NotFoundException(CONVERSATION_NOT_FOUND_MESSAGE));
		if (!isMember(conversation, authenticatedUserId)) {
			throw new ForbiddenException(CONVERSATION_FORBIDDEN_MESSAGE);
		}
		User otherUser = userRepository.findById(otherUserId(conversation, authenticatedUserId))
				.orElseThrow(() -> new IllegalStateException("Conversation user was not found"));
		ConversationLastMessageResponse lastMessage = loadLastMessages(List.of(conversation))
				.get(conversation.getId());
		return new ConversationDetailResponse(
				conversation.getId(),
				toOtherUserResponse(otherUser),
				lastMessage,
				conversation.getCreatedAt(),
				conversation.getUpdatedAt());
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

	private int parseLimit(String requestedLimit) {
		try {
			int limit = Integer.parseInt(requestedLimit);
			if (limit < 1 || limit > 50) {
				throw new ValidationException(INVALID_LIMIT_MESSAGE);
			}
			return limit;
		} catch (NumberFormatException exception) {
			throw new ValidationException(INVALID_LIMIT_MESSAGE);
		}
	}

	private Map<UUID, User> loadOtherUsers(
			List<Conversation> conversations,
			UUID authenticatedUserId) {
		List<UUID> otherUserIds = conversations.stream()
				.map(conversation -> otherUserId(conversation, authenticatedUserId))
				.distinct()
				.toList();
		Map<UUID, User> usersById = new HashMap<>();
		userRepository.findAllById(otherUserIds)
				.forEach(user -> usersById.put(user.getId(), user));
		return usersById;
	}

	private Map<UUID, ConversationLastMessageResponse> loadLastMessages(
			List<Conversation> conversations) {
		if (conversations.isEmpty()) {
			return Map.of();
		}
		List<UUID> conversationIds = conversations.stream()
				.map(Conversation::getId)
				.toList();
		Map<UUID, ConversationLastMessageResponse> messagesByConversationId = new HashMap<>();
		messageRepository.findLatestForConversations(conversationIds).forEach(message ->
				messagesByConversationId.put(
						message.getConversationId(),
						new ConversationLastMessageResponse(
								message.getContent(),
								message.getSenderId(),
								message.getClientTimestamp(),
								message.getStatus())));
		return messagesByConversationId;
	}

	private User otherUser(
			Conversation conversation,
			UUID authenticatedUserId,
			Map<UUID, User> usersById) {
		User user = usersById.get(otherUserId(conversation, authenticatedUserId));
		if (user == null) {
			throw new IllegalStateException("Conversation user was not found");
		}
		return user;
	}

	private UUID otherUserId(Conversation conversation, UUID authenticatedUserId) {
		return conversation.getUserAId().equals(authenticatedUserId)
				? conversation.getUserBId()
				: conversation.getUserAId();
	}

	private boolean isMember(Conversation conversation, UUID userId) {
		return conversation.getUserAId().equals(userId)
				|| conversation.getUserBId().equals(userId);
	}

	private ConversationResponse.OtherUserResponse toOtherUserResponse(User otherUser) {
		return new ConversationResponse.OtherUserResponse(
				otherUser.getId(),
				otherUser.getDisplayName(),
				otherUser.getAvatarUrl());
	}

	private record ConversationPair(UUID userAId, UUID userBId) {
	}

	public record CreateResult(ConversationResponse response, boolean created) {
	}
}
