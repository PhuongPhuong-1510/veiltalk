package com.veiltalk.auth;

import java.time.Instant;
import java.util.UUID;

public record JwtClaims(
		UUID subject,
		UserRole role,
		String type,
		UUID jwtId,
		Instant issuedAt,
		Instant expiresAt) {
}
