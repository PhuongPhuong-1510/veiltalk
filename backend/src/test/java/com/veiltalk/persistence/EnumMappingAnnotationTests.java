package com.veiltalk.persistence;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;

import java.lang.reflect.Field;

import org.junit.jupiter.api.Test;

import com.veiltalk.auth.User;
import com.veiltalk.auth.UserRoleConverter;
import com.veiltalk.messaging.Message;
import com.veiltalk.messaging.MessageStatusConverter;
import com.veiltalk.video.Video;
import com.veiltalk.video.VideoStatusConverter;

import jakarta.persistence.Convert;
import jakarta.persistence.Enumerated;

class EnumMappingAnnotationTests {

	@Test
	void enumFieldsUseExplicitConvertersWithoutEnumerated() throws NoSuchFieldException {
		assertConverter(User.class.getDeclaredField("role"), UserRoleConverter.class);
		assertConverter(Message.class.getDeclaredField("status"), MessageStatusConverter.class);
		assertConverter(Video.class.getDeclaredField("status"), VideoStatusConverter.class);
	}

	private void assertConverter(Field field, Class<?> converterType) {
		Convert convert = field.getAnnotation(Convert.class);
		assertEquals(converterType, convert.converter());
		assertFalse(field.isAnnotationPresent(Enumerated.class));
	}
}
