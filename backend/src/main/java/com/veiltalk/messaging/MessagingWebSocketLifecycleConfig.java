package com.veiltalk.messaging;

import java.time.Clock;

import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.scheduling.concurrent.ThreadPoolTaskScheduler;

@Configuration
public class MessagingWebSocketLifecycleConfig {

	@Bean(defaultCandidate = false)
	ThreadPoolTaskScheduler messagingWebSocketTaskScheduler() {
		ThreadPoolTaskScheduler taskScheduler = new ThreadPoolTaskScheduler();
		taskScheduler.setPoolSize(2);
		taskScheduler.setThreadNamePrefix("messaging-ws-");
		taskScheduler.setWaitForTasksToCompleteOnShutdown(false);
		return taskScheduler;
	}

	@Bean
	Clock messagingWebSocketClock() {
		return Clock.systemUTC();
	}
}
