package com.veiltalk.messaging;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.doReturn;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.HashMap;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ScheduledFuture;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.scheduling.TaskScheduler;
import org.springframework.web.socket.CloseStatus;
import org.springframework.web.socket.TextMessage;
import org.springframework.web.socket.WebSocketSession;

import com.veiltalk.auth.JwtBlacklistService;
import com.veiltalk.auth.UserTokenRevocationService;
import com.veiltalk.messaging.WebSocketSessionRegistry.SessionState;

import io.micrometer.core.instrument.Counter;
import io.micrometer.core.instrument.MeterRegistry;

@ExtendWith(MockitoExtension.class)
class WebSocketKeepAliveSchedulerTests {

	private static final UUID USER_ID = UUID.fromString("a310fc8c-109f-4e53-91ee-8fcd508f7512");
	private static final UUID JWT_ID = UUID.fromString("f135fa09-a49b-4278-9705-338d69132fcf");
	private static final Instant NOW = Instant.parse("2026-07-25T01:00:00Z");
	private static final Instant ISSUED_AT = NOW.minusSeconds(60);
	private static final Instant EXPIRES_AT = NOW.plusSeconds(900);
	private static final TextMessage PING = new TextMessage("{\"type\":\"PING\"}");

	@Mock
	private JwtBlacklistService jwtBlacklistService;

	@Mock
	private UserTokenRevocationService userTokenRevocationService;

	@Mock
	private TaskScheduler taskScheduler;

	@Mock
	private MeterRegistry meterRegistry;

	@Mock
	private Counter failureCounter;

	@Mock
	private ScheduledFuture<?> heartbeatFuture;

	@Mock
	private ScheduledFuture<?> expiryFuture;

	private WebSocketSessionRegistry registry;
	private WebSocketSession delegateSession;
	private SessionState state;
	private WebSocketKeepAliveScheduler scheduler;

	@BeforeEach
	void setUp() {
		registry = new WebSocketSessionRegistry(10_000, 262_144);
		delegateSession = mock(WebSocketSession.class);
		when(delegateSession.getId()).thenReturn("session");
		when(delegateSession.getAttributes()).thenReturn(attributes());
		state = registry.register(USER_ID, delegateSession);
		doReturn(heartbeatFuture).when(taskScheduler).scheduleAtFixedRate(
				any(Runnable.class),
				any(Instant.class),
				any(Duration.class));
		doReturn(expiryFuture).when(taskScheduler).schedule(
				any(Runnable.class),
				any(Instant.class));
		when(meterRegistry.counter("messaging.websocket.auth.recheck.failures"))
				.thenReturn(failureCounter);
		scheduler = new WebSocketKeepAliveScheduler(
				registry,
				jwtBlacklistService,
				userTokenRevocationService,
				taskScheduler,
				Clock.fixed(NOW, ZoneOffset.UTC),
				meterRegistry,
				30_000);
	}

	@Test
	void sendsPingImmediatelyAndCloses4003AfterTwoUnansweredPings() throws Exception {
		when(delegateSession.isOpen()).thenReturn(true);
		scheduler.start(state);
		Runnable heartbeat = capturedHeartbeat();

		heartbeat.run();
		heartbeat.run();

		verify(delegateSession, times(2)).sendMessage(PING);
		verify(delegateSession).close(WebSocketKeepAliveScheduler.HEARTBEAT_TIMEOUT);
		assertThat(registry.connectionCount(USER_ID)).isZero();
		verify(heartbeatFuture).cancel(false);
		verify(expiryFuture).cancel(false);
	}

	@Test
	void pongResetsUnansweredPingCounterAndKeepsSessionOpen() throws Exception {
		scheduler.start(state);
		Runnable heartbeat = capturedHeartbeat();

		scheduler.pongReceived(state);
		heartbeat.run();
		scheduler.pongReceived(state);
		heartbeat.run();

		verify(delegateSession, times(3)).sendMessage(PING);
		verify(delegateSession, never()).close(any(CloseStatus.class));
		assertThat(registry.connectionCount(USER_ID)).isEqualTo(1);
	}

	@Test
	void expiryTimerCloses4002() throws Exception {
		when(delegateSession.isOpen()).thenReturn(true);
		scheduler.start(state);
		capturedExpiry().run();

		verify(delegateSession).close(WebSocketKeepAliveScheduler.TOKEN_EXPIRED_OR_REVOKED);
		assertThat(registry.connectionCount(USER_ID)).isZero();
	}

	@Test
	void heartbeatRevocationCloses4002() throws Exception {
		when(delegateSession.isOpen()).thenReturn(true);
		scheduler.start(state);
		when(jwtBlacklistService.isBlacklisted(JWT_ID)).thenReturn(true);
		capturedHeartbeat().run();

		verify(delegateSession).close(WebSocketKeepAliveScheduler.TOKEN_EXPIRED_OR_REVOKED);
		assertThat(registry.connectionCount(USER_ID)).isZero();
	}

	@Test
	void redisFailureDuringRecheckIncrementsMetricButKeepsSession() throws Exception {
		scheduler.start(state);
		when(jwtBlacklistService.isBlacklisted(JWT_ID))
				.thenThrow(new IllegalStateException("Redis unavailable"));

		capturedHeartbeat().run();

		verify(failureCounter).increment();
		verify(delegateSession, times(2)).sendMessage(PING);
		verify(delegateSession, never()).close(any(CloseStatus.class));
		assertThat(registry.connectionCount(USER_ID)).isEqualTo(1);
	}

	@Test
	void schedulesHeartbeatRelativeToConnectionAndExpiryAtJwtExp() {
		scheduler.start(state);

		verify(taskScheduler).scheduleAtFixedRate(
				any(Runnable.class),
				org.mockito.ArgumentMatchers.eq(NOW.plusSeconds(30)),
				org.mockito.ArgumentMatchers.eq(Duration.ofSeconds(30)));
		verify(taskScheduler).schedule(any(Runnable.class), org.mockito.ArgumentMatchers.eq(EXPIRES_AT));
	}

	private Runnable capturedHeartbeat() {
		ArgumentCaptor<Runnable> captor = ArgumentCaptor.forClass(Runnable.class);
		verify(taskScheduler).scheduleAtFixedRate(
				captor.capture(),
				any(Instant.class),
				any(Duration.class));
		return captor.getValue();
	}

	private Runnable capturedExpiry() {
		ArgumentCaptor<Runnable> captor = ArgumentCaptor.forClass(Runnable.class);
		verify(taskScheduler).schedule(captor.capture(), any(Instant.class));
		return captor.getValue();
	}

	private Map<String, Object> attributes() {
		Map<String, Object> attributes = new HashMap<>();
		attributes.put(WebSocketAuthHandshakeInterceptor.USER_ID_ATTRIBUTE, USER_ID);
		attributes.put(WebSocketAuthHandshakeInterceptor.JWT_ID_ATTRIBUTE, JWT_ID);
		attributes.put(WebSocketAuthHandshakeInterceptor.JWT_ISSUED_AT_ATTRIBUTE, ISSUED_AT);
		attributes.put(WebSocketAuthHandshakeInterceptor.JWT_EXPIRES_AT_ATTRIBUTE, EXPIRES_AT);
		return attributes;
	}
}
