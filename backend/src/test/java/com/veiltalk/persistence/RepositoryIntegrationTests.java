package com.veiltalk.persistence;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.time.Instant;
import java.util.UUID;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Slice;
import org.springframework.transaction.annotation.Transactional;

import com.veiltalk.auth.RefreshTokenRepository;
import com.veiltalk.auth.User;
import com.veiltalk.auth.UserRepository;
import com.veiltalk.avatar.AvatarProfileRepository;
import com.veiltalk.messaging.Conversation;
import com.veiltalk.messaging.ConversationRepository;
import com.veiltalk.messaging.Message;
import com.veiltalk.messaging.MessageRepository;
import com.veiltalk.video.VideoRepository;

import jakarta.persistence.EntityManager;

@SpringBootTest
@Transactional
class RepositoryIntegrationTests {

	@Autowired
	private UserRepository userRepository;

	@Autowired
	private RefreshTokenRepository refreshTokenRepository;

	@Autowired
	private AvatarProfileRepository avatarProfileRepository;

	@Autowired
	private ConversationRepository conversationRepository;

	@Autowired
	private MessageRepository messageRepository;

	@Autowired
	private VideoRepository videoRepository;

	@Autowired
	private EntityManager entityManager;

	@Test
	void registersAllSixRepositories() {
		assertNotNull(userRepository);
		assertNotNull(refreshTokenRepository);
		assertNotNull(avatarProfileRepository);
		assertNotNull(conversationRepository);
		assertNotNull(messageRepository);
		assertNotNull(videoRepository);
	}

	@Test
	void userQueriesRespectDiscoverableAndSoftDelete() {
		User discoverableUser = createUser("discoverable", true);
		User privateUser = createUser("private", false);
		User deletedUser = createUser("deleted", true);
		deletedUser.setDeletedAt(Instant.now());

		userRepository.save(discoverableUser);
		userRepository.save(privateUser);
		userRepository.save(deletedUser);
		entityManager.flush();

		assertTrue(userRepository.findByEmailAndDeletedAtIsNull(discoverableUser.getEmail()).isPresent());
		assertTrue(userRepository.findByEmailAndDeletedAtIsNull(privateUser.getEmail()).isPresent());
		assertFalse(userRepository.findByEmailAndDeletedAtIsNull(deletedUser.getEmail()).isPresent());

		assertTrue(userRepository
				.findByEmailAndIsDiscoverableTrueAndDeletedAtIsNull(discoverableUser.getEmail())
				.isPresent());
		assertFalse(userRepository
				.findByEmailAndIsDiscoverableTrueAndDeletedAtIsNull(privateUser.getEmail())
				.isPresent());
		assertFalse(userRepository
				.findByEmailAndIsDiscoverableTrueAndDeletedAtIsNull(deletedUser.getEmail())
				.isPresent());
	}

	@Test
	void messageQueryExcludesSoftDeletedRowsAndReturnsAscendingSlice() {
		User sender = userRepository.save(createUser("sender", false));
		User recipient = userRepository.save(createUser("recipient", false));
		entityManager.flush();

		Conversation conversation = new Conversation();
		conversation.setUserAId(sender.getId());
		conversation.setUserBId(recipient.getId());
		conversationRepository.save(conversation);
		entityManager.flush();

		Instant baseTime = Instant.parse("2026-01-01T00:00:00Z");
		Message first = createMessage(conversation.getId(), sender.getId(), baseTime.plusSeconds(1));
		Message second = createMessage(conversation.getId(), sender.getId(), baseTime.plusSeconds(2));
		Message third = createMessage(conversation.getId(), sender.getId(), baseTime.plusSeconds(3));
		Message deleted = createMessage(conversation.getId(), sender.getId(), baseTime);
		deleted.setDeletedAt(baseTime.plusSeconds(4));

		messageRepository.save(first);
		messageRepository.save(second);
		messageRepository.save(third);
		messageRepository.save(deleted);
		entityManager.flush();

		Slice<Message> slice = messageRepository
				.findByConversationIdAndDeletedAtIsNullOrderByClientTimestampAsc(
						conversation.getId(),
						PageRequest.of(0, 2));

		assertEquals(2, slice.getNumberOfElements());
		assertEquals(first.getId(), slice.getContent().get(0).getId());
		assertEquals(second.getId(), slice.getContent().get(1).getId());
		assertTrue(slice.hasNext());
	}

	private User createUser(String prefix, boolean discoverable) {
		User user = new User();
		user.setEmail(prefix + "-" + UUID.randomUUID() + "@example.com");
		user.setPasswordHash("test-only-hash");
		user.setDisplayName(prefix);
		user.setDiscoverable(discoverable);
		return user;
	}

	private Message createMessage(UUID conversationId, UUID senderId, Instant clientTimestamp) {
		Message message = new Message();
		message.setId(UUID.randomUUID());
		message.setConversationId(conversationId);
		message.setSenderId(senderId);
		message.setContent("repository integration test");
		message.setClientTimestamp(clientTimestamp);
		return message;
	}
}
