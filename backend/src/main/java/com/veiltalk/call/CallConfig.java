package com.veiltalk.call;

import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.context.annotation.Configuration;

@Configuration
@EnableConfigurationProperties(CallNotifyProperties.class)
public class CallConfig {
}
