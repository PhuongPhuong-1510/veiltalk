package com.veiltalk.auth;

import java.net.InetAddress;
import java.net.UnknownHostException;
import java.util.Arrays;
import java.util.Set;
import java.util.stream.Collectors;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.server.ServerHttpRequest;
import org.springframework.stereotype.Component;

import jakarta.servlet.http.HttpServletRequest;

@Component
public class AuthClientIpResolver {
	private final Set<String> trustedProxies;

	public AuthClientIpResolver(@Value("${auth.abuse.trusted-proxy-ips:}") String configuredProxies) {
		trustedProxies = Arrays.stream(configuredProxies.split(","))
				.map(String::trim).filter(value -> !value.isEmpty())
				.map(AuthClientIpResolver::canonicalIp).collect(Collectors.toUnmodifiableSet());
	}

	public String resolve(HttpServletRequest request) {
		return resolve(request.getRemoteAddr(), request.getHeader("X-Forwarded-For"));
	}

	public String resolve(ServerHttpRequest request) {
		return resolve(request.getRemoteAddress().getAddress().getHostAddress(),
				request.getHeaders().getFirst("X-Forwarded-For"));
	}

	private String resolve(String remoteAddress, String forwarded) {
		String remote = canonicalIp(remoteAddress);
		if (!trustedProxies.contains(remote)) return remote;
		if (forwarded == null || forwarded.isBlank()) return remote;
		// The trusted reverse proxy must overwrite, rather than append to, this header.
		if (forwarded.contains(",")) return remote;
		try {
			return canonicalIp(forwarded.trim());
		} catch (IllegalArgumentException exception) {
			return remote;
		}
	}

	private static String canonicalIp(String value) {
		try {
			if (value == null || !value.matches("[0-9a-fA-F:.]+")) throw new IllegalArgumentException("Invalid IP");
			return InetAddress.getByName(value).getHostAddress();
		} catch (UnknownHostException exception) {
			throw new IllegalArgumentException("Invalid IP", exception);
		}
	}
}
