package com.veiltalk.messaging;

import jakarta.persistence.AttributeConverter;
import jakarta.persistence.Converter;

@Converter
public class MessageStatusConverter implements AttributeConverter<MessageStatus, String> {

	@Override
	public String convertToDatabaseColumn(MessageStatus attribute) {
		return attribute == null ? null : attribute.getDatabaseValue();
	}

	@Override
	public MessageStatus convertToEntityAttribute(String dbData) {
		return dbData == null ? null : MessageStatus.fromDatabaseValue(dbData);
	}
}
