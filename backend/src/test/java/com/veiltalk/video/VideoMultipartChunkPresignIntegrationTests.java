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
 * Kiểm chứng THẬT phần P2-T21 nối tiếp part 1 của P2-T20: PUT part 2 lên MinIO qua URL do
 * cùng {@code presignPartUrl} cấp, xác nhận nhận ETag. Có 2 part thật trong cùng một uploadId
 * là nền để P2-T22 gọi CompleteMultipartUpload ghép file.
 *
 * <p>Gate sau MINIO_INTEGRATION_TEST giống {@code VideoMultipartPresignIntegrationTests},
 * không chạy trong CI thường.
 */
@SpringBootTest(
        classes = {MinioConfig.class, MinioMultipartStorage.class},
        webEnvironment = SpringBootTest.WebEnvironment.NONE)
@EnabledIfEnvironmentVariable(named = "MINIO_INTEGRATION_TEST", matches = "(?i)true")
class VideoMultipartChunkPresignIntegrationTests {

    // Part multipart phải ≥ 5MB (trừ part cuối). Dùng đúng 5MB để MinIO chấp nhận.
    private static final int PART_SIZE = 5 * 1024 * 1024;

    @Autowired
    private VideoMultipartStorage multipartStorage;

    @Autowired
    private MinioAsyncClient minioAsyncClient;

    @Autowired
    private MinioProperties minioProperties;

    @Test
    void nextChunkUrlAcceptsPartTwoAndReturnsEtag() throws Exception {
        ensureBucketExists();
        String objectKey = "videos/it-" + UUID.randomUUID() + "/source.mp4";
        String uploadId = multipartStorage.createMultipartUpload(objectKey);
        assertThat(uploadId).isNotBlank();

        try (HttpClient httpClient = HttpClient.newBuilder()
                .connectTimeout(Duration.ofSeconds(10))
                .build()) {
            // Part 1 — mô phỏng đúng những gì client làm sau POST /videos (T20).
            String etag1 = putPart(httpClient, objectKey, uploadId, 1);
            assertThat(etag1).isNotBlank();

            // Part 2 — presign qua cùng hàm mà VideoService.requestNextChunk (T21) gọi.
            String partTwoUrl = multipartStorage.presignPartUrl(objectKey, uploadId, 2);
            assertThat(partTwoUrl).contains("uploadId=" + uploadId).contains("partNumber=2");
            String etag2 = putPart(httpClient, objectKey, uploadId, 2, partTwoUrl);

            // Hai part thật, hai ETag khác nhau — sẵn sàng cho T22 ghép.
            assertThat(etag2).isNotBlank();
            assertThat(etag2).isNotEqualTo(etag1);
        } finally {
            // Dọn phiên multipart dở để không để lại part rác trên MinIO.
            minioAsyncClient
                    .abortMultipartUploadAsync(
                            minioProperties.bucket(), null, objectKey, uploadId, null, null)
                    .get();
        }
    }

    private String putPart(HttpClient httpClient, String objectKey, String uploadId, int partNumber)
            throws Exception {
        return putPart(httpClient, objectKey, uploadId, partNumber,
                multipartStorage.presignPartUrl(objectKey, uploadId, partNumber));
    }

    private String putPart(
            HttpClient httpClient, String objectKey, String uploadId, int partNumber, String partUrl)
            throws Exception {
        // Nội dung khác nhau giữa các part để ETag (MD5 mỗi part) khác nhau.
        byte[] part = new byte[PART_SIZE];
        java.util.Arrays.fill(part, (byte) partNumber);
        HttpResponse<Void> response = httpClient.send(
                HttpRequest.newBuilder(URI.create(partUrl))
                        .timeout(Duration.ofSeconds(60))
                        .PUT(HttpRequest.BodyPublishers.ofByteArray(part))
                        .build(),
                HttpResponse.BodyHandlers.discarding());

        assertThat(response.statusCode()).isBetween(200, 299);
        Optional<String> etag = response.headers().firstValue("ETag");
        assertThat(etag).isPresent();
        return etag.get().replace("\"", "");
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
