package com.veiltalk.video;

import jakarta.persistence.AttributeConverter;
import jakarta.persistence.Converter;

@Converter
public class VideoStatusConverter implements AttributeConverter<VideoStatus, String> {

	@Override
	public String convertToDatabaseColumn(VideoStatus attribute) {
		return attribute == null ? null : attribute.getDatabaseValue();
	}

	@Override
	public VideoStatus convertToEntityAttribute(String dbData) {
		return dbData == null ? null : VideoStatus.fromDatabaseValue(dbData);
	}
}
