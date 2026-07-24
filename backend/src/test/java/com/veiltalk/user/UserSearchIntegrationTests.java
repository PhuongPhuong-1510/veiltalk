package com.veiltalk.user;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.content;
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
import org.springframework.transaction.annotation.Transactional;

@SpringBootTest
@AutoConfigureMockMvc
@Transactional
class UserSearchIntegrationTests {

	@Autowired
	private MockMvc mockMvc;

	@Autowired
	private UserRepository userRepository;

	@Autowired
	private JwtService jwtService;

	@Autowired
	private StringRedisTemplate redisTemplate;

	private User searcher;
	private User target;
	private String targetEmail;
	private String accessToken;
	private String rateKey;

	@BeforeEach
	void createUsers() {
		searcher = createUser("searcher", "Searcher");
		target = createUser("target", "Target user");
		targetEmail = target.getEmail();
		target.setDiscoverable(true);
		userRepository.saveAndFlush(target);
		accessToken = jwtService.generateAccessToken(searcher.getId(), searcher.getRole());
		long window = System.currentTimeMillis() / 1000 / 60;
		rateKey = "rate:user-search:" + searcher.getId() + ":" + window;
	}

	@AfterEach
	void clearRateLimitKey() {
		redisTemplate.delete(rateKey);
	}

	@Test
	void tc16FindsDiscoverableUserWithoutExposingEmail() throws Exception {
		mockMvc.perform(searchRequest(targetEmail))
				.andExpect(status().isOk())
				.andExpect(jsonPath("$.found").value(true))
				.andExpect(jsonPath("$.user.id").value(target.getId().toString()))
				.andExpect(jsonPath("$.user.display_name").value("Target user"))
				.andExpect(jsonPath("$.user.email").doesNotExist());
	}

	@Test
	void tc17ReturnsNeutralResponseForNonDiscoverableUser() throws Exception {
		target.setDiscoverable(false);
		userRepository.saveAndFlush(target);

		mockMvc.perform(searchRequest(targetEmail))
				.andExpect(status().isOk())
				.andExpect(content().json("{\"found\":false}"));
	}

	@Test
	void tc18ReturnsSameNeutralResponseForUnknownEmail() throws Exception {
		target.setDiscoverable(false);
		userRepository.saveAndFlush(target);
		String hidden = mockMvc.perform(searchRequest(targetEmail))
				.andExpect(status().isOk())
				.andReturn().getResponse().getContentAsString();
		String unknown = mockMvc.perform(searchRequest("missing@example.com"))
				.andExpect(status().isOk())
				.andReturn().getResponse().getContentAsString();
		assertThat(hidden).isEqualTo(unknown);
	}

	@Test
	void tc19RateLimitsEleventhRequestAndReturnsRetryAfter() throws Exception {
		for (int i = 0; i < 10; i++) {
			mockMvc.perform(searchRequest(targetEmail)).andExpect(status().isOk());
		}
		mockMvc.perform(searchRequest(targetEmail))
				.andExpect(status().isTooManyRequests())
				.andExpect(header().string("Retry-After", org.hamcrest.Matchers.not(org.hamcrest.Matchers.isEmptyOrNullString())));
	}

	@Test
	void rejectsInvalidEmail() throws Exception {
		mockMvc.perform(searchRequest("not-an-email"))
				.andExpect(status().isBadRequest())
				.andExpect(jsonPath("$.error.code").value("VALIDATION_ERROR"));
	}

	private User createUser(String email, String displayName) {
		User user = new User();
		user.setEmail(email + "-" + UUID.randomUUID() + "@example.com");
		user.setPasswordHash("test-only-hash");
		user.setDisplayName(displayName);
		return userRepository.saveAndFlush(user);
	}

	private org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder searchRequest(String email) {
		return post("/users/search")
				.header("Authorization", "Bearer " + accessToken)
				.contentType(MediaType.APPLICATION_JSON)
				.content("{\"email\":\"" + email + "\"}");
	}
}
