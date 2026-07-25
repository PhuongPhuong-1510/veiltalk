package com.veiltalk.video;

import java.util.List;

import com.fasterxml.jackson.annotation.JsonProperty;

public record VideoWebhookRequest(
		@JsonProperty("Records") List<NotificationRecord> records) {

	public record NotificationRecord(
			String eventName,
			S3Data s3) {
	}

	public record S3Data(
			BucketData bucket,
			ObjectData object) {
	}

	public record BucketData(String name) {
	}

	public record ObjectData(
			String key,
			Long size) {
	}
}
