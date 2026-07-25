package com.veiltalk.video;

import static org.assertj.core.api.Assertions.assertThat;

import io.minio.BucketExistsArgs;
import io.minio.MakeBucketArgs;
import io.minio.MinioAsyncClient;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.util.Optional;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;

/**
 * Kiểm chứng presign part multipart THẬT với MinIO — điều kiện coi P2-T20 hoàn tất.
 *
 * <p>Mock ở {@code VideoCreateIntegrationTests} không kiểm được query {@code uploadId}/
 * {@code partNumber} hay object key có đúng không; chỉ MinIO thật mới xác nhận PUT lên
 * presigned URL được ghi nhận là part (trả về ETag). Gate sau MINIO_INTEGRATION_TEST
 * giống {@code MinioClientIntegrationTests}, không chạy trong CI thường.
 */
@SpringBootTest(
        classes = {MinioConfig.class, MinioMultipartStorage.class},
        webEnvironment = SpringBootTest.WebEnvironment.NONE)
@EnabledIfEnvironmentVariable(named = "MINIO_INTEGRATION_TEST", matches = "(?i)true")
class VideoMultipartPresignIntegrationTests {

    // Part multipart phải ≥ 5MB (trừ part cuối). Dùng đúng 5MB để MinIO chấp nhận.
    private static final int PART_SIZE = 5 * 1024 * 1024;

    @Autowired
    private VideoMultipartStorage multipartStorage;

    @Autowired
    private MinioAsyncClient minioAsyncClient;

    @Autowired
    private MinioProperties minioProperties;

    @Test
    void presignedPartUrlIsAcceptedAsMultipartPartAndReturnsEtag() throws Exception {
        ensureBucketExists();
        String objectKey = "videos/it-" + UUID.randomUUID() + "/source.mp4";
        String uploadId = multipartStorage.createMultipartUpload(objectKey);
        assertThat(uploadId).isNotBlank();

        try (HttpClient httpClient = HttpClient.newBuilder()
                .connectTimeout(Duration.ofSeconds(10))
                .build()) {
            String partUrl = multipartStorage.presignPartUrl(objectKey, uploadId, 1);
            assertThat(partUrl).contains("uploadId=" + uploadId).contains("partNumber=1");

            byte[] part = new byte[PART_SIZE];
            HttpResponse<Void> response = httpClient.send(
                    HttpRequest.newBuilder(URI.create(partUrl))
                            .timeout(Duration.ofSeconds(60))
                            .PUT(HttpRequest.BodyPublishers.ofByteArray(part))
                            .build(),
                    HttpResponse.BodyHandlers.discarding());

            assertThat(response.statusCode()).isBetween(200, 299);
            Optional<String> etag = response.headers().firstValue("ETag");
            assertThat(etag).isPresent();
            assertThat(etag.get().replace("\"", "")).isNotBlank();
        } finally {
            // Dọn phiên multipart dở để không để lại part rác trên MinIO.
            minioAsyncClient
                    .abortMultipartUploadAsync(
                            minioProperties.bucket(), null, objectKey, uploadId, null, null)
                    .get();
        }
    }

    private void ensureBucketExists() throws Exception {
        boolean exists = minioAsyncClient
                .bucketExists(BucketExistsArgs.builder().bucket(minioProperties.bucket()).build())
                .get();
        if (!exists) {
            minioAsyncClient
                    .makeBucket(MakeBucketArgs.builder().bucket(minioProperties.bucket()).build())
                    .get();
        }
    }
}
