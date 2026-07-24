package com.veiltalk.persistence;

import static org.junit.jupiter.api.Assertions.assertEquals;

import java.time.Instant;
import java.util.UUID;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.transaction.annotation.Transactional;

import com.veiltalk.auth.User;
import com.veiltalk.auth.UserRole;
import com.veiltalk.messaging.Conversation;
import com.veiltalk.messaging.Message;
import com.veiltalk.messaging.MessageStatus;
import com.veiltalk.user.Theme;
import com.veiltalk.video.Video;
import com.veiltalk.video.VideoStatus;

import jakarta.persistence.EntityManager;

@SpringBootTest
@Transactional
class EnumPersistenceIntegrationTests {

	@Autowired
	private EntityManager entityManager;

	@Autowired
	private JdbcTemplate jdbcTemplate;

	@Test
	void persistsLowercaseValuesAndReadsUppercaseJavaEnums() {
		User sender = createUser("sender");
		sender.setTheme(Theme.DARK);
		User recipient = createUser("recipient");
		entityManager.persist(sender);
		entityManager.persist(recipient);
		entityManager.flush();

		Conversation conversation = new Conversation();
		conversation.setUserAId(sender.getId());
		conversation.setUserBId(recipient.getId());
		entityManager.persist(conversation);
		entityManager.flush();

		Message message = new Message();
		message.setId(UUID.randomUUID());
		message.setConversationId(conversation.getId());
		message.setSenderId(sender.getId());
		message.setContent("enum converter integration test");
		message.setStatus(MessageStatus.READ);
		message.setClientTimestamp(Instant.now());
		entityManager.persist(message);

		Video video = new Video();
		video.setUserId(sender.getId());
		video.setTitle("enum converter integration test");
		video.setStoragePath("tests/enum-converter.mp4");
		video.setFileSizeBytes(1L);
		video.setStatus(VideoStatus.FAILED);
		entityManager.persist(video);
		entityManager.flush();

		assertEquals("user", queryValue("users", "role", sender.getId()));
		assertEquals("dark", queryValue("users", "theme", sender.getId()));
		assertEquals("read", queryValue("messages", "status", message.getId()));
		assertEquals("failed", queryValue("videos", "status", video.getId()));

		entityManager.clear();

		assertEquals(UserRole.USER, entityManager.find(User.class, sender.getId()).getRole());
		assertEquals(Theme.DARK, entityManager.find(User.class, sender.getId()).getTheme());
		assertEquals(MessageStatus.READ, entityManager.find(Message.class, message.getId()).getStatus());
		assertEquals(VideoStatus.FAILED, entityManager.find(Video.class, video.getId()).getStatus());
	}

	private User createUser(String prefix) {
		User user = new User();
		user.setEmail(prefix + "-" + UUID.randomUUID() + "@example.com");
		user.setPasswordHash("test-only-hash");
		user.setDisplayName(prefix);
		user.setRole(UserRole.USER);
		return user;
	}

	private String queryValue(String table, String column, UUID id) {
		String sql = "SELECT " + column + " FROM " + table + " WHERE id = ?";
		return jdbcTemplate.queryForObject(sql, String.class, id);
	}
}
