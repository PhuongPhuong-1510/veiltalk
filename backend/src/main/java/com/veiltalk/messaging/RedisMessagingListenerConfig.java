package com.veiltalk.messaging;

import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.data.redis.connection.RedisConnectionFactory;
import org.springframework.data.redis.listener.PatternTopic;
import org.springframework.data.redis.listener.RedisMessageListenerContainer;

@Configuration
public class RedisMessagingListenerConfig {

	static final String USER_CHANNEL_PATTERN = "messaging:user:*";

	@Bean
	RedisMessageListenerContainer messagingRedisMessageListenerContainer(
			RedisConnectionFactory connectionFactory,
			MessagingRedisSubscriber subscriber) {
		RedisMessageListenerContainer container = new RedisMessageListenerContainer();
		container.setConnectionFactory(connectionFactory);
		container.addMessageListener(subscriber, new PatternTopic(USER_CHANNEL_PATTERN));
		container.setErrorHandler(subscriber::handleContainerError);
		return container;
	}
}
