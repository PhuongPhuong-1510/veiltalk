package com.veiltalk.persistence;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;

import org.junit.jupiter.api.Test;

import com.veiltalk.auth.UserRole;
import com.veiltalk.auth.UserRoleConverter;
import com.veiltalk.messaging.MessageStatus;
import com.veiltalk.messaging.MessageStatusConverter;
import com.veiltalk.video.VideoStatus;
import com.veiltalk.video.VideoStatusConverter;

class EnumConverterTests {

	private final UserRoleConverter userRoleConverter = new UserRoleConverter();
	private final MessageStatusConverter messageStatusConverter = new MessageStatusConverter();
	private final VideoStatusConverter videoStatusConverter = new VideoStatusConverter();

	@Test
	void convertsUserRoleBetweenJavaAndDatabaseValues() {
		for (UserRole role : UserRole.values()) {
			assertEquals(role.name().toLowerCase(), userRoleConverter.convertToDatabaseColumn(role));
			assertEquals(role, userRoleConverter.convertToEntityAttribute(role.name().toLowerCase()));
		}
	}

	@Test
	void convertsMessageStatusBetweenJavaAndDatabaseValues() {
		for (MessageStatus status : MessageStatus.values()) {
			assertEquals(status.name().toLowerCase(), messageStatusConverter.convertToDatabaseColumn(status));
			assertEquals(status, messageStatusConverter.convertToEntityAttribute(status.name().toLowerCase()));
		}
	}

	@Test
	void convertsVideoStatusBetweenJavaAndDatabaseValues() {
		for (VideoStatus status : VideoStatus.values()) {
			assertEquals(status.name().toLowerCase(), videoStatusConverter.convertToDatabaseColumn(status));
			assertEquals(status, videoStatusConverter.convertToEntityAttribute(status.name().toLowerCase()));
		}
	}

	@Test
	void preservesNullValues() {
		assertNull(userRoleConverter.convertToDatabaseColumn(null));
		assertNull(userRoleConverter.convertToEntityAttribute(null));
		assertNull(messageStatusConverter.convertToDatabaseColumn(null));
		assertNull(messageStatusConverter.convertToEntityAttribute(null));
		assertNull(videoStatusConverter.convertToDatabaseColumn(null));
		assertNull(videoStatusConverter.convertToEntityAttribute(null));
	}

	@Test
	void rejectsUnknownDatabaseValues() {
		assertThrows(IllegalArgumentException.class,
				() -> userRoleConverter.convertToEntityAttribute("super_admin"));
		assertThrows(IllegalArgumentException.class,
				() -> messageStatusConverter.convertToEntityAttribute("deleted"));
		assertThrows(IllegalArgumentException.class,
				() -> videoStatusConverter.convertToEntityAttribute("uploaded"));
	}
}
