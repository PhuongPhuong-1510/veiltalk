package com.veiltalk.video;

import static org.assertj.core.api.Assertions.assertThat;

import java.net.URI;
import java.util.Map;
import java.util.concurrent.TimeUnit;

import org.junit.jupiter.api.Test;

import io.minio.GetPresignedObjectUrlArgs;
import io.minio.MinioAsyncClient;
import io.minio.http.Method;

class MinioPublicEndpointTests {

	@Test
	void signedUploadUrlUsesPublicOriginAndBucketPath() throws Exception {
		MinioProperties properties = new MinioProperties("http://minio:9000", "test-access",
				"test-secret", "veiltalk", new MinioProperties.Webhook("unused"),
				"https://app.example.test");
		MinioConfig config = new MinioConfig();
		MinioAsyncClient internal = config.minioAsyncClient(properties);
		MinioAsyncClient publicClient = config.presignMinioAsyncClient(properties, internal);

		URI url = URI.create(publicClient.getPresignedObjectUrl(GetPresignedObjectUrlArgs.builder()
				.method(Method.PUT)
				.bucket("veiltalk")
				.object("videos/test/source.mp4")
				.extraQueryParams(Map.of("uploadId", "upload-1", "partNumber", "1"))
				.expiry(300, TimeUnit.SECONDS)
				.build()));

		assertThat(url.getScheme()).isEqualTo("https");
		assertThat(url.getHost()).isEqualTo("app.example.test");
		assertThat(url.getPath()).isEqualTo("/veiltalk/videos/test/source.mp4");
		assertThat(url.getRawQuery()).contains("X-Amz-Signature=").contains("uploadId=upload-1");
	}
}
