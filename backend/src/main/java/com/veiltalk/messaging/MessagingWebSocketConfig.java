package com.veiltalk.messaging;

import java.util.Arrays;

import jakarta.servlet.ServletContext;
import jakarta.websocket.server.ServerContainer;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Condition;
import org.springframework.context.annotation.ConditionContext;
import org.springframework.context.annotation.Conditional;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.core.type.AnnotatedTypeMetadata;
import org.springframework.util.StringUtils;
import org.springframework.web.context.WebApplicationContext;
import org.springframework.web.socket.config.annotation.EnableWebSocket;
import org.springframework.web.socket.config.annotation.WebSocketConfigurer;
import org.springframework.web.socket.config.annotation.WebSocketHandlerRegistry;
import org.springframework.web.socket.server.standard.ServletServerContainerFactoryBean;

@Configuration
@EnableWebSocket
public class MessagingWebSocketConfig implements WebSocketConfigurer {

	private final MessagingWebSocketHandler messagingWebSocketHandler;
	private final WebSocketAuthHandshakeInterceptor authHandshakeInterceptor;
	private final String[] allowedOrigins;

	public MessagingWebSocketConfig(
			MessagingWebSocketHandler messagingWebSocketHandler,
			WebSocketAuthHandshakeInterceptor authHandshakeInterceptor,
			@Value("${app.cors.allowed-origins}") String allowedOrigins) {
		this.messagingWebSocketHandler = messagingWebSocketHandler;
		this.authHandshakeInterceptor = authHandshakeInterceptor;
		this.allowedOrigins = parseAllowedOrigins(allowedOrigins);
	}

	@Override
	public void registerWebSocketHandlers(WebSocketHandlerRegistry registry) {
		registry.addHandler(messagingWebSocketHandler, "/ws/messaging")
				.addInterceptors(authHandshakeInterceptor)
				.setAllowedOrigins(allowedOrigins);
	}

	@Bean
	@Conditional(ServerContainerAvailableCondition.class)
	ServletServerContainerFactoryBean webSocketContainer(
			@Value("${messaging.websocket.max-text-message-size}") int maxTextMessageSize) {
		if (maxTextMessageSize <= 0) {
			throw new IllegalArgumentException("Messaging WebSocket text message limit must be positive");
		}
		ServletServerContainerFactoryBean container = new ServletServerContainerFactoryBean();
		container.setMaxTextMessageBufferSize(maxTextMessageSize);
		return container;
	}

	static final class ServerContainerAvailableCondition implements Condition {

		@Override
		public boolean matches(ConditionContext context, AnnotatedTypeMetadata metadata) {
			if (!(context.getResourceLoader() instanceof WebApplicationContext webApplicationContext)) {
				return false;
			}
			ServletContext servletContext = webApplicationContext.getServletContext();
			return servletContext != null
					&& servletContext.getAttribute(ServerContainer.class.getName()) != null;
		}
	}

	static String[] parseAllowedOrigins(String configuredOrigins) {
		String[] origins = Arrays.stream(StringUtils.commaDelimitedListToStringArray(configuredOrigins))
				.map(String::trim)
				.filter(origin -> !origin.isEmpty())
				.distinct()
				.toArray(String[]::new);
		if (origins.length == 0 || Arrays.asList(origins).contains("*")) {
			throw new IllegalArgumentException("Messaging WebSocket requires explicit allowed origins");
		}
		return origins;
	}
}
