package com.veiltalk.call;

import org.springframework.boot.context.properties.ConfigurationProperties;

@ConfigurationProperties(prefix = "call.notify")
public record CallNotifyProperties(String secret) {
}
