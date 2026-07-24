package com.veiltalk.user;

import jakarta.persistence.AttributeConverter;
import jakarta.persistence.Converter;

@Converter
public class ThemeConverter implements AttributeConverter<Theme, String> {

	@Override
	public String convertToDatabaseColumn(Theme attribute) {
		return attribute == null ? null : attribute.getDatabaseValue();
	}

	@Override
	public Theme convertToEntityAttribute(String databaseValue) {
		return databaseValue == null ? null : Theme.fromDatabaseValue(databaseValue);
	}
}
