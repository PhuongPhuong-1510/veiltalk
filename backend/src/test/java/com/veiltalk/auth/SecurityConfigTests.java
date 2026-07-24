package com.veiltalk.auth;

import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.content;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.time.Instant;
import java.util.UUID;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.autoconfigure.web.servlet.WebMvcTest;
import org.springframework.context.annotation.Import;
import org.springframework.http.MediaType;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

@WebMvcTest(controllers = SecurityConfigTests.TestController.class)
@AutoConfigureMockMvc
@Import({
		SecurityConfig.class,
		SecurityConfigTests.TestController.class
})
class SecurityConfigTests {

	private static final UUID USER_ID = UUID.fromString("a310fc8c-109f-4e53-91ee-8fcd508f7512");
	private static final UUID JWT_ID = UUID.fromString("f135fa09-a49b-4278-9705-338d69132fcf");

	@Autowired
	private MockMvc mockMvc;

	@MockitoBean
	private JwtService jwtService;

	@MockitoBean
	private JwtBlacklistService jwtBlacklistService;

	@Test
	void publicRoutesDoNotRequireAuthentication() throws Exception {
		mockMvc.perform(get("/auth/test"))
				.andExpect(status().isOk());
		mockMvc.perform(get("/actuator/health"))
				.andExpect(status().isOk());
		mockMvc.perform(get("/internal/test"))
				.andExpect(status().isOk());
	}

	@Test
	void logoutRequiresAuthenticationAlthoughOtherAuthRoutesArePublic() throws Exception {
		mockMvc.perform(post("/auth/logout"))
				.andExpect(status().isUnauthorized());
	}

	@Test
	void protectedRouteWithoutTokenReturnsStandardUnauthorizedResponse() throws Exception {
		mockMvc.perform(get("/protected"))
				.andExpect(status().isUnauthorized())
				.andExpect(content().contentTypeCompatibleWith(MediaType.APPLICATION_JSON))
				.andExpect(jsonPath("$.error.code").value("UNAUTHORIZED"))
				.andExpect(jsonPath("$.error.message").value("Authentication is required"))
				.andExpect(jsonPath("$.error.details").isMap());
	}

	@Test
	void protectedRouteAcceptsValidAccessToken() throws Exception {
		when(jwtService.extractClaims("valid-token")).thenReturn(accessClaims());

		mockMvc.perform(get("/protected").header("Authorization", "Bearer valid-token"))
				.andExpect(status().isOk());
	}

	@Test
	void protectedRouteRejectsInvalidAndRefreshTokens() throws Exception {
		when(jwtService.extractClaims("invalid-token"))
				.thenThrow(new IllegalArgumentException("Invalid token"));
		when(jwtService.extractClaims("refresh-token")).thenReturn(refreshClaims());

		mockMvc.perform(get("/protected").header("Authorization", "Bearer invalid-token"))
				.andExpect(status().isUnauthorized());
		mockMvc.perform(get("/protected").header("Authorization", "Bearer refresh-token"))
				.andExpect(status().isUnauthorized());
	}

	@Test
	void responsesContainConfiguredSecurityAndCorsHeaders() throws Exception {
		mockMvc.perform(get("/auth/test")
						.secure(true)
						.header("Origin", "https://app.veiltalk.example.com"))
				.andExpect(status().isOk())
				.andExpect(header().string(
						"Strict-Transport-Security",
						"max-age=31536000 ; includeSubDomains"))
				.andExpect(header().string("X-Content-Type-Options", "nosniff"))
				.andExpect(header().string("X-Frame-Options", "DENY"))
				.andExpect(header().string(
						"Access-Control-Allow-Origin",
						"https://app.veiltalk.example.com"));
	}

	private JwtClaims accessClaims() {
		return new JwtClaims(
				USER_ID,
				UserRole.USER,
				"access",
				JWT_ID,
				Instant.parse("2026-07-24T12:00:00Z"),
				Instant.parse("2026-07-24T12:15:00Z"));
	}

	private JwtClaims refreshClaims() {
		return new JwtClaims(
				null,
				null,
				"refresh",
				JWT_ID,
				Instant.parse("2026-07-24T12:00:00Z"),
				Instant.parse("2026-07-31T12:00:00Z"));
	}

	@RestController
	public static class TestController {

		@GetMapping({"/auth/test", "/actuator/health", "/internal/test", "/protected"})
		String ok() {
			return "ok";
		}
	}
}
