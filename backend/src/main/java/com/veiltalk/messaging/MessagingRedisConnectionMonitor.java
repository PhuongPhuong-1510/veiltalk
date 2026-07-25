package com.veiltalk.messaging;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.data.redis.connection.RedisConnectionFactory;
import org.springframework.data.redis.connection.lettuce.LettuceConnectionFactory;
import org.springframework.stereotype.Component;

import io.lettuce.core.event.Event;
import io.lettuce.core.event.connection.ConnectedEvent;
import io.lettuce.core.event.connection.DisconnectedEvent;
import jakarta.annotation.PreDestroy;
import reactor.core.Disposable;

@Component
public class MessagingRedisConnectionMonitor {

	private static final Logger LOGGER =
			LoggerFactory.getLogger(MessagingRedisConnectionMonitor.class);

	private final MessagingRedisSubscriber subscriber;
	private final Disposable eventSubscription;

	public MessagingRedisConnectionMonitor(
			RedisConnectionFactory connectionFactory,
			MessagingRedisSubscriber subscriber) {
		this.subscriber = subscriber;
		if (connectionFactory instanceof LettuceConnectionFactory lettuceConnectionFactory) {
			eventSubscription = lettuceConnectionFactory.getClientResources()
					.eventBus()
					.get()
					.subscribe(this::handleEvent, this::handleEventBusFailure);
		}
		else {
			eventSubscription = null;
			LOGGER.warn(
					"Messaging Redis connection health monitor requires Lettuce; "
							+ "listener container errors remain monitored");
		}
	}

	@PreDestroy
	void stop() {
		if (eventSubscription != null) {
			eventSubscription.dispose();
		}
	}

	private void handleEvent(Event event) {
		if (event instanceof DisconnectedEvent) {
			subscriber.handleContainerError(
					new IllegalStateException("Redis connection disconnected"));
		}
		else if (event instanceof ConnectedEvent) {
			subscriber.handleConnectionRestored();
		}
	}

	private void handleEventBusFailure(Throwable throwable) {
		subscriber.handleContainerError(throwable);
	}
}
