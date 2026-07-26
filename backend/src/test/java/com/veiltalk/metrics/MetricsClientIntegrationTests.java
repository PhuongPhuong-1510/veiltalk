package com.veiltalk.metrics;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.util.UUID;

import com.veiltalk.auth.JwtService;
import com.veiltalk.auth.User;
import com.veiltalk.auth.UserRepository;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;
import org.springframework.transaction.annotation.Transactional;

@SpringBootTest
@AutoConfigureMockMvc
@Transactional
class MetricsClientIntegrationTests {

	@Autowired
	private MockMvc mockMvc;

	@Autowired
	private UserRepository userRepository;

	@Autowired
	private JwtService jwtService;

	@Autowired
	private StringRedisTemplate redisTemplate;

	private String accessToken;
	private String rateKey;

	@BeforeEach
	void createUser() {
		User user = new User();
		user.setEmail("metrics-" + UUID.randomUUID() + "@example.com");
		user.setPasswordHash("test-only-hash");
		user.setDisplayName("Metrics user");
		user = userRepository.saveAndFlush(user);
		accessToken = jwtService.generateAccessToken(user.getId(), user.getRole());
		long window = System.currentTimeMillis() / 1000 / 3;
		rateKey = "rate:metrics-client:" + user.getId() + ":" + window;
	}

	@AfterEach
	void clearRateLimitKey() {
		redisTemplate.delete(rateKey);
	}

	@Test
	void acceptsValidCallMetricsAndReturnsNoContent() throws Exception {
		mockMvc.perform(metricsRequest(validCallBody()))
				.andExpect(status().isNoContent());
	}

	@Test
	void acceptsPreviewMetricsWithoutOptionalFields() throws Exception {
		String body = "{\"session_type\":\"preview\",\"timestamp\":\"2026-07-26T10:00:00Z\"}";
		mockMvc.perform(metricsRequest(body))
				.andExpect(status().isNoContent());
	}

	@Test
	void rejectsMissingSessionType() throws Exception {
		String body = "{\"timestamp\":\"2026-07-26T10:00:00Z\"}";
		mockMvc.perform(metricsRequest(body))
				.andExpect(status().isBadRequest())
				.andExpect(jsonPath("$.error.code").value("VALIDATION_ERROR"));
	}

	@Test
	void rejectsInvalidSessionType() throws Exception {
		String body = "{\"session_type\":\"bogus\",\"timestamp\":\"2026-07-26T10:00:00Z\"}";
		mockMvc.perform(metricsRequest(body))
				.andExpect(status().isBadRequest())
				.andExpect(jsonPath("$.error.code").value("VALIDATION_ERROR"));
	}

	@Test
	void rejectsUnparsableTimestamp() throws Exception {
		String body = "{\"session_type\":\"call\",\"timestamp\":\"not-a-timestamp\"}";
		mockMvc.perform(metricsRequest(body))
				.andExpect(status().isBadRequest())
				.andExpect(jsonPath("$.error.code").value("VALIDATION_ERROR"));
	}

	@Test
	void rejectsRequestWithoutAuthentication() throws Exception {
		mockMvc.perform(post("/metrics/client")
				.contentType(MediaType.APPLICATION_JSON)
				.content(validCallBody()))
				.andExpect(status().isUnauthorized());
	}

	@Test
	void rateLimitsSecondRequestWithinThreeSecondsAndReturnsRetryAfter() throws Exception {
		mockMvc.perform(metricsRequest(validCallBody()))
				.andExpect(status().isNoContent());
		mockMvc.perform(metricsRequest(validCallBody()))
				.andExpect(status().isTooManyRequests())
				.andExpect(header().string("Retry-After", org.hamcrest.Matchers.not(org.hamcrest.Matchers.isEmptyOrNullString())));
	}

	private String validCallBody() {
		return "{\"session_type\":\"call\",\"tracking_latency_ms\":80,\"fps\":27.5,"
				+ "\"webrtc_rtt_ms\":120,\"timestamp\":\"2026-07-26T10:00:00Z\"}";
	}

	private MockHttpServletRequestBuilder metricsRequest(String body) {
		return post("/metrics/client")
				.header("Authorization", "Bearer " + accessToken)
				.contentType(MediaType.APPLICATION_JSON)
				.content(body);
	}
}
