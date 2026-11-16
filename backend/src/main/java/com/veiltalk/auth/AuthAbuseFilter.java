package com.veiltalk.auth;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.time.Duration;

import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;

@Component
public class AuthAbuseFilter extends OncePerRequestFilter {
	private final AuthAbuseRateLimiter limiter;
	private final AuthClientIpResolver ipResolver;

	public AuthAbuseFilter(AuthAbuseRateLimiter limiter, AuthClientIpResolver ipResolver) {
		this.limiter = limiter;
		this.ipResolver = ipResolver;
	}

	@Override
	protected boolean shouldNotFilter(HttpServletRequest request) {
		return !"POST".equals(request.getMethod()) ||
				!("/auth/login".equals(request.getRequestURI()) || "/auth/register".equals(request.getRequestURI()));
	}

	@Override
	protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response, FilterChain chain)
			throws ServletException, IOException {
		String ip = ipResolver.resolve(request);
		boolean register = "/auth/register".equals(request.getRequestURI());
		try {
			if (register) limiter.checkRegistrationFailures(ip);
			else limiter.checkLoginIp(ip);
		} catch (TooManyRequestsException exception) {
			writeRateLimit(response, exception.retryAfter());
			return;
		}
		chain.doFilter(request, response);
		int status = response.getStatus();
		if (register && status >= 400 && status < 500 && status != 429) {
			try { limiter.recordRegistrationFailure(ip); }
			catch (TooManyRequestsException ignored) { /* The next request receives 429. */ }
		} else if (!register && (status == 400 || status == 401)) {
			try { limiter.recordLoginIpFailure(ip); }
			catch (TooManyRequestsException ignored) { /* The next request receives 429. */ }
		}
	}

	private void writeRateLimit(HttpServletResponse response, Duration retryAfter) throws IOException {
		long seconds = Math.max(1, (retryAfter.toMillis() + 999) / 1000);
		response.setStatus(429);
		response.setCharacterEncoding(StandardCharsets.UTF_8.name());
		response.setContentType("application/json");
		response.setHeader("Retry-After", String.valueOf(seconds));
		response.getWriter().write("{\"error\":{\"code\":\"RATE_LIMITED\",\"message\":\"Too many requests\",\"details\":{}}}");
	}
}
