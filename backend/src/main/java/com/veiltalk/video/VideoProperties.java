package com.veiltalk.video;

import org.springframework.boot.context.properties.ConfigurationProperties;

@ConfigurationProperties(prefix = "video")
public record VideoProperties(
        long storageLimitBytes) {
}
