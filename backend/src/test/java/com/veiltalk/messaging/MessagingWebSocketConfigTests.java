package com.veiltalk.messaging;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.mock;

import org.junit.jupiter.api.Test;
import org.springframework.boot.test.util.TestPropertyValues;
import org.springframework.mock.web.MockServletContext;
import org.springframework.web.context.support.AnnotationConfigWebApplicationContext;

class MessagingWebSocketConfigTests {

	@Test
	void allowedOriginsAreTrimmedAndDeduplicated() {
		assertThat(MessagingWebSocketConfig.parseAllowedOrigins(
				"http://localhost:5173, https://app.veiltalk.example.com,http://localhost:5173"))
				.containsExactly(
						"http://localhost:5173",
						"https://app.veiltalk.example.com");
	}

	@Test
	void wildcardOrEmptyAllowedOriginsAreRejected() {
		assertThatThrownBy(() -> MessagingWebSocketConfig.parseAllowedOrigins("*"))
				.isInstanceOf(IllegalArgumentException.class);
		assertThatThrownBy(() -> MessagingWebSocketConfig.parseAllowedOrigins(" , "))
				.isInstanceOf(IllegalArgumentException.class);
	}

	@Test
	void mockServletContextWithoutServerContainerSkipsContainerFactoryBean() {
		try (AnnotationConfigWebApplicationContext context =
				new AnnotationConfigWebApplicationContext()) {
			context.setServletContext(new MockServletContext());
			TestPropertyValues.of(
					"app.cors.allowed-origins=http://localhost:5173",
					"messaging.websocket.max-text-message-size=32768")
					.applyTo(context);
			context.addBeanFactoryPostProcessor(beanFactory -> {
				beanFactory.registerSingleton(
						"messagingWebSocketHandler",
						mock(MessagingWebSocketHandler.class));
				beanFactory.registerSingleton(
						"webSocketAuthHandshakeInterceptor",
						mock(WebSocketAuthHandshakeInterceptor.class));
			});
			context.register(MessagingWebSocketConfig.class);

			context.refresh();

			assertThat(context.containsBean("webSocketContainer")).isFalse();
		}
	}
}
