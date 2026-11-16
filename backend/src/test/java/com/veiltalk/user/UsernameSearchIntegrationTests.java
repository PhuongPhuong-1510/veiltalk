package com.veiltalk.user;

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
import org.springframework.transaction.annotation.Transactional;

@SpringBootTest
@AutoConfigureMockMvc
@Transactional
class UsernameSearchIntegrationTests {

	@Autowired MockMvc mockMvc;
	@Autowired UserRepository userRepository;
	@Autowired JwtService jwtService;
	@Autowired StringRedisTemplate redisTemplate;

	private User searcher;
	private String accessToken;

	@BeforeEach
	void setup() {
		searcher = createUser("searcher_user", true, "Searcher");
		accessToken = jwtService.generateAccessToken(searcher.getId(), searcher.getRole());
	}

	@AfterEach
	void clearRateLimit() {
		redisTemplate.delete("rate:username-search:" + searcher.getId());
	}

	@Test
	void returnsExactBeforePrefixAndNeverReturnsRequesterOrHiddenUsers() throws Exception {
		User exact = createUser("minh", true, "Exact");
		User prefix = createUser("minh.nguyen", true, "Prefix");
		createUser("minh.hidden", false, "Hidden");

		mockMvc.perform(search("minh", 10))
				.andExpect(status().isOk())
				.andExpect(jsonPath("$.data.length()").value(2))
				.andExpect(jsonPath("$.data[0].id").value(exact.getId().toString()))
				.andExpect(jsonPath("$.data[0].username").value("minh"))
				.andExpect(jsonPath("$.data[1].id").value(prefix.getId().toString()))
				.andExpect(jsonPath("$.data[0].email").doesNotExist())
				.andExpect(jsonPath("$.meta.truncated").value(false));
	}

	@Test
	void escapesUnderscoreInsteadOfTreatingItAsLikeWildcard() throws Exception {
		createUser("minh_name", true, "Underscore");
		createUser("minh1name", true, "Digit");

		mockMvc.perform(search("minh_", 10))
				.andExpect(status().isOk())
				.andExpect(jsonPath("$.data.length()").value(1))
				.andExpect(jsonPath("$.data[0].username").value("minh_name"));
	}

	@Test
	void limitsResultsWithoutCountAndReportsTruncation() throws Exception {
		for (int i = 0; i < 4; i++) createUser("common" + i, true, "Common " + i);

		mockMvc.perform(search("common", 3))
				.andExpect(status().isOk())
				.andExpect(jsonPath("$.data.length()").value(3))
				.andExpect(jsonPath("$.meta.limit").value(3))
				.andExpect(jsonPath("$.meta.truncated").value(true))
				.andExpect(jsonPath("$.meta.total_count").doesNotExist());
	}

	@Test
	void rateLimitsBurstAndReturnsJsonEnvelopeWithRetryAfter() throws Exception {
		for (int i = 0; i < 10; i++) mockMvc.perform(search("nobody", 10)).andExpect(status().isOk());

		mockMvc.perform(search("nobody", 10))
				.andExpect(status().isTooManyRequests())
				.andExpect(header().exists("Retry-After"))
				.andExpect(jsonPath("$.error.code").value("RATE_LIMITED"));
	}

	@Test
	void rejectsShortOrInvalidQueries() throws Exception {
		mockMvc.perform(search("ab", 10)).andExpect(status().isBadRequest());
		mockMvc.perform(search("bad%", 10)).andExpect(status().isBadRequest());
	}

	private User createUser(String username, boolean searchable, String displayName) {
		User user = new User();
		user.setEmail(username + "-" + UUID.randomUUID() + "@example.com");
		user.setPasswordHash("test-only-hash");
		user.setDisplayName(displayName);
		user.setUsername(username);
		user.setUsernameSearchable(searchable);
		return userRepository.saveAndFlush(user);
	}

	private org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder search(String query, int limit) {
		return post("/users/search/usernames")
				.header("Authorization", "Bearer " + accessToken)
				.contentType(MediaType.APPLICATION_JSON)
				.content("{\"query\":\"" + query + "\",\"limit\":" + limit + "}");
	}
}
