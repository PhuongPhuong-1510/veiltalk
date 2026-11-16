package com.veiltalk.video;

import io.minio.MinioAsyncClient;
import io.minio.MinioClient;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.util.StringUtils;
import org.springframework.context.annotation.Primary;
import org.springframework.beans.factory.annotation.Qualifier;

@Configuration
@EnableConfigurationProperties({MinioProperties.class, VideoProperties.class})
public class MinioConfig {

    @Bean
    MinioClient minioClient(MinioProperties properties) {
        MinioClient.Builder builder = MinioClient.builder().endpoint(properties.endpoint());
        boolean hasAccessKey = StringUtils.hasText(properties.accessKey());
        boolean hasSecretKey = StringUtils.hasText(properties.secretKey());

        if (hasAccessKey != hasSecretKey) {
            throw new IllegalStateException(
                    "MINIO_ACCESS_KEY và MINIO_SECRET_KEY phải được cấu hình cùng nhau");
        }
        if (hasAccessKey) {
            builder.credentials(properties.accessKey(), properties.secretKey());
        }

        return builder.build();
    }

    // MinioAsyncClient công khai low-level multipart API (createMultipartUpload...) mà
    // MinioClient không expose — cần cho luồng quay video P2-T20→T22.
    @Bean
    @Primary
    MinioAsyncClient minioAsyncClient(MinioProperties properties) {
        MinioAsyncClient.Builder builder =
                MinioAsyncClient.builder().endpoint(properties.endpoint());
        boolean hasAccessKey = StringUtils.hasText(properties.accessKey());
        boolean hasSecretKey = StringUtils.hasText(properties.secretKey());

        if (hasAccessKey != hasSecretKey) {
            throw new IllegalStateException(
                    "MINIO_ACCESS_KEY và MINIO_SECRET_KEY phải được cấu hình cùng nhau");
        }
        if (hasAccessKey) {
            builder.credentials(properties.accessKey(), properties.secretKey());
        }

        return builder.build();
    }

    @Bean("presignMinioAsyncClient")
    MinioAsyncClient presignMinioAsyncClient(MinioProperties properties,
            @Qualifier("minioAsyncClient") MinioAsyncClient internalClient) {
        if (!StringUtils.hasText(properties.publicEndpoint())) {
            return internalClient;
        }
        MinioAsyncClient.Builder builder = MinioAsyncClient.builder()
                .endpoint(properties.publicEndpoint())
                // MinIO's default region; avoids a public-network lookup just to sign a URL.
                .region("us-east-1");
        builder.credentials(properties.accessKey(), properties.secretKey());
        return builder.build();
    }
}
