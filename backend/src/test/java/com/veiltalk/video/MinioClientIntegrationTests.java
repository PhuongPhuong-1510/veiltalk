package com.veiltalk.video;

import static org.assertj.core.api.Assertions.assertThat;

import io.minio.BucketExistsArgs;
import io.minio.GetPresignedObjectUrlArgs;
import io.minio.MakeBucketArgs;
import io.minio.MinioClient;
import io.minio.RemoveBucketArgs;
import io.minio.RemoveObjectArgs;
import io.minio.StatObjectArgs;
import io.minio.http.Method;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.Locale;
import java.util.UUID;
import java.util.concurrent.TimeUnit;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.system.CapturedOutput;
import org.springframework.boot.test.system.OutputCaptureExtension;
import org.junit.jupiter.api.extension.ExtendWith;

@SpringBootTest(
        classes = MinioConfig.class,
        webEnvironment = SpringBootTest.WebEnvironment.NONE)
@ExtendWith(OutputCaptureExtension.class)
@EnabledIfEnvironmentVariable(named = "MINIO_INTEGRATION_TEST", matches = "(?i)true")
class MinioClientIntegrationTests {

    private static final byte[] SAMPLE_CONTENT =
            "VeilTalk P2-T19 MinIO integration".getBytes(StandardCharsets.UTF_8);

    @Autowired
    private MinioClient minioClient;

    @Autowired
    private MinioProperties minioProperties;

    @Test
    void presignedPutAndGetWorkEndToEndAndCleanupSucceeds(CapturedOutput output)
            throws Exception {
        assertConfigurationIsBound();
        assertThat(minioClient).isNotNull();

        String bucketName = "veiltalk-it-"
                + UUID.randomUUID().toString().replace("-", "").toLowerCase(Locale.ROOT);
        String objectName = "sample.txt";
        boolean bucketCreated = false;
        boolean objectCreated = false;

        assertThat(bucketName).isNotEqualTo(minioProperties.bucket());

        try (HttpClient httpClient = HttpClient.newBuilder()
                .connectTimeout(Duration.ofSeconds(10))
                .build()) {
            minioClient.makeBucket(MakeBucketArgs.builder().bucket(bucketName).build());
            bucketCreated = true;
            assertThat(minioClient.bucketExists(
                    BucketExistsArgs.builder().bucket(bucketName).build())).isTrue();

            String putUrl = presignedUrl(Method.PUT, bucketName, objectName);
            HttpResponse<Void> putResponse = httpClient.send(
                    HttpRequest.newBuilder(URI.create(putUrl))
                            .timeout(Duration.ofSeconds(30))
                            .PUT(HttpRequest.BodyPublishers.ofByteArray(SAMPLE_CONTENT))
                            .build(),
                    HttpResponse.BodyHandlers.discarding());
            assertThat(putResponse.statusCode()).isBetween(200, 299);
            objectCreated = true;

            assertThat(minioClient.statObject(StatObjectArgs.builder()
                    .bucket(bucketName)
                    .object(objectName)
                    .build()).size()).isEqualTo(SAMPLE_CONTENT.length);

            String getUrl = presignedUrl(Method.GET, bucketName, objectName);
            HttpResponse<byte[]> getResponse = httpClient.send(
                    HttpRequest.newBuilder(URI.create(getUrl))
                            .timeout(Duration.ofSeconds(30))
                            .GET()
                            .build(),
                    HttpResponse.BodyHandlers.ofByteArray());
            assertThat(getResponse.statusCode()).isEqualTo(200);
            assertThat(getResponse.body()).isEqualTo(SAMPLE_CONTENT);
        } finally {
            if (objectCreated) {
                minioClient.removeObject(RemoveObjectArgs.builder()
                        .bucket(bucketName)
                        .object(objectName)
                        .build());
            }
            if (bucketCreated) {
                minioClient.removeBucket(
                        RemoveBucketArgs.builder().bucket(bucketName).build());
                assertThat(minioClient.bucketExists(
                        BucketExistsArgs.builder().bucket(bucketName).build())).isFalse();
            }
            assertThat(output.getAll())
                    .doesNotContain(minioProperties.accessKey())
                    .doesNotContain(minioProperties.secretKey());
        }
    }

    private String presignedUrl(Method method, String bucketName, String objectName)
            throws Exception {
        return minioClient.getPresignedObjectUrl(GetPresignedObjectUrlArgs.builder()
                .method(method)
                .bucket(bucketName)
                .object(objectName)
                .expiry(15, TimeUnit.MINUTES)
                .build());
    }

    private void assertConfigurationIsBound() {
        assertThat(minioProperties.endpoint())
                .isEqualTo(System.getenv("MINIO_ENDPOINT"))
                .isNotBlank();
        assertThat(minioProperties.accessKey())
                .isEqualTo(System.getenv("MINIO_ACCESS_KEY"))
                .isNotBlank();
        assertThat(minioProperties.secretKey())
                .isEqualTo(System.getenv("MINIO_SECRET_KEY"))
                .isNotBlank();
        assertThat(minioProperties.bucket())
                .isEqualTo(System.getenv("MINIO_BUCKET"))
                .isNotBlank();
    }
}
