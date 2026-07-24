package com.veiltalk.auth;

import java.io.IOException;
import java.util.List;

import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.web.filter.OncePerRequestFilter;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;

public class JwtAuthenticationFilter extends OncePerRequestFilter {

	private static final String AUTHORIZATION_HEADER = "Authorization";
	private static final String BEARER_PREFIX = "Bearer ";
	private static final String ACCESS_TOKEN_TYPE = "access";

	private final JwtService jwtService;
	private final JwtBlacklistService jwtBlacklistService;

	public JwtAuthenticationFilter(
			JwtService jwtService,
			JwtBlacklistService jwtBlacklistService) {
		this.jwtService = jwtService;
		this.jwtBlacklistService = jwtBlacklistService;
	}

	@Override
	protected void doFilterInternal(
			HttpServletRequest request,
			HttpServletResponse response,
			FilterChain filterChain) throws ServletException, IOException {
		String token = extractBearerToken(request);
		if (token != null && SecurityContextHolder.getContext().getAuthentication() == null) {
			authenticate(token);
		}
		filterChain.doFilter(request, response);
	}

	private String extractBearerToken(HttpServletRequest request) {
		String header = request.getHeader(AUTHORIZATION_HEADER);
		if (header == null
				|| header.length() <= BEARER_PREFIX.length()
				|| !header.regionMatches(true, 0, BEARER_PREFIX, 0, BEARER_PREFIX.length())) {
			return null;
		}
		String token = header.substring(BEARER_PREFIX.length()).trim();
		return token.isEmpty() ? null : token;
	}

	private void authenticate(String token) {
		try {
			JwtClaims claims = jwtService.extractClaims(token);
			if (!ACCESS_TOKEN_TYPE.equals(claims.type())
					|| claims.subject() == null
					|| claims.role() == null
					|| jwtBlacklistService.isBlacklisted(claims.jwtId())) {
				return;
			}

			var authority = new SimpleGrantedAuthority("ROLE_" + claims.role().name());
			var authentication = UsernamePasswordAuthenticationToken.authenticated(
					claims.subject(),
					token,
					List.of(authority));
			SecurityContextHolder.getContext().setAuthentication(authentication);
		}
		catch (IllegalArgumentException exception) {
			// Token không hợp lệ được xem như request chưa xác thực; entry point sẽ trả 401 nếu cần.
		}
	}
}
