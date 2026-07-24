package com.veiltalk.auth;

import jakarta.persistence.AttributeConverter;
import jakarta.persistence.Converter;

@Converter
public class UserRoleConverter implements AttributeConverter<UserRole, String> {

	@Override
	public String convertToDatabaseColumn(UserRole attribute) {
		return attribute == null ? null : attribute.getDatabaseValue();
	}

	@Override
	public UserRole convertToEntityAttribute(String dbData) {
		return dbData == null ? null : UserRole.fromDatabaseValue(dbData);
	}
}
