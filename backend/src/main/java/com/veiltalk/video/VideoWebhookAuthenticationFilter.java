package com.veiltalk.video;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;

import org.springframework.http.MediaType;
import org.springframework.stereotype.Component;
import org.springframework.util.StringUtils;
import org.springframework.web.filter.OncePerRequestFilter;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;

@Component
public class VideoWebhookAuthenticationFilter extends OncePerRequestFilter {

	private static final String WEBHOOK_PATH = "/internal/videos/webhook";
	private static final String UNAUTHORIZED_RESPONSE =
			"{\"error\":{\"code\":\"UNAUTHORIZED\",\"message\":\"Invalid webhook credentials\",\"details\":{}}}";

	private final byte[] expectedAuthorization;

	public VideoWebhookAuthenticationFilter(MinioProperties properties) {
		String secret = properties.webhook() == null ? null : properties.webhook().secret();
		if (!StringUtils.hasText(secret)) {
			throw new IllegalStateException("MINIO_WEBHOOK_SECRET phải được cấu hình và không được rỗng");
		}
		this.expectedAuthorization = ("Bearer " + secret).getBytes(StandardCharsets.UTF_8);
	}

	@Override
	protected boolean shouldNotFilter(HttpServletRequest request) {
		return !"POST".equalsIgnoreCase(request.getMethod())
				|| !WEBHOOK_PATH.equals(request.getRequestURI());
	}

	@Override
	protected void doFilterInternal(
			HttpServletRequest request,
			HttpServletResponse response,
			FilterChain filterChain) throws ServletException, IOException {
		String provided = request.getHeader("Authorization");
		byte[] providedBytes = provided == null
				? new byte[0]
				: provided.getBytes(StandardCharsets.UTF_8);
		if (!MessageDigest.isEqual(expectedAuthorization, providedBytes)) {
			response.setStatus(HttpServletResponse.SC_UNAUTHORIZED);
			response.setCharacterEncoding(StandardCharsets.UTF_8.name());
			response.setContentType(MediaType.APPLICATION_JSON_VALUE);
			response.getWriter().write(UNAUTHORIZED_RESPONSE);
			return;
		}
		filterChain.doFilter(request, response);
	}
}
