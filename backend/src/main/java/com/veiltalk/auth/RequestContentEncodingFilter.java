package com.veiltalk.auth;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.util.Collections;
import java.util.List;

import org.springframework.http.MediaType;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;

@Component
public class RequestContentEncodingFilter extends OncePerRequestFilter {

	@Override
	protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response,
			FilterChain chain) throws ServletException, IOException {
		List<String> encodings = Collections.list(request.getHeaders("Content-Encoding"));
		if (!encodings.isEmpty()
				&& (encodings.size() != 1 || !encodings.getFirst().equalsIgnoreCase("identity"))) {
			response.setStatus(HttpServletResponse.SC_UNSUPPORTED_MEDIA_TYPE);
			response.setCharacterEncoding(StandardCharsets.UTF_8.name());
			response.setContentType(MediaType.APPLICATION_JSON_VALUE);
			response.getWriter().write(
				"{\"error\":{\"code\":\"UNSUPPORTED_MEDIA_TYPE\",\"message\":\"Unsupported Content-Encoding\",\"details\":{}}}");
			return;
		}
		chain.doFilter(request, response);
	}
}
