package com.veiltalk.auth;

import java.nio.charset.StandardCharsets;

public final class InternalSecretPolicy {
	private InternalSecretPolicy() { }

	public static String requireStrongSecret(String secret, String name) {
		if (secret == null || secret.isBlank()
				|| secret.getBytes(StandardCharsets.UTF_8).length < 32) {
			throw new IllegalStateException(name + " must contain at least 32 UTF-8 bytes");
		}
		return secret;
	}
}
