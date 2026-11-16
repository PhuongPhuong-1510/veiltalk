package com.veiltalk.video;

import org.springframework.boot.context.properties.ConfigurationProperties;

@ConfigurationProperties(prefix = "minio")
public record MinioProperties(
        String endpoint,
        String accessKey,
        String secretKey,
        String bucket,
        Webhook webhook,
        String publicEndpoint) {

    public record Webhook(String secret) {
    }
}
