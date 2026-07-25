package com.veiltalk.video;

import static org.assertj.core.api.Assertions.assertThatThrownBy;

import org.junit.jupiter.api.Test;

class VideoWebhookAuthenticationFilterTests {

	@Test
	void blankOrMissingSecretFailsFast() {
		assertThatThrownBy(() -> new VideoWebhookAuthenticationFilter(properties(null)))
				.isInstanceOf(IllegalStateException.class)
				.hasMessageContaining("MINIO_WEBHOOK_SECRET");
		assertThatThrownBy(() -> new VideoWebhookAuthenticationFilter(properties("  ")))
				.isInstanceOf(IllegalStateException.class)
				.hasMessageContaining("MINIO_WEBHOOK_SECRET");
	}

	private MinioProperties properties(String webhookSecret) {
		return new MinioProperties(
				"http://localhost:9000",
				"access",
				"secret",
				"veiltalk",
				new MinioProperties.Webhook(webhookSecret));
	}
}
