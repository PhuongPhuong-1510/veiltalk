package com.veiltalk.auth;

import java.util.Optional;
import java.util.UUID;

import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.data.jpa.repository.JpaRepository;

public interface RefreshTokenRepository extends JpaRepository<RefreshToken, UUID> {

	Optional<RefreshToken> findByTokenHash(String tokenHash);

	@Modifying(flushAutomatically = true, clearAutomatically = true)
	@Query("""
			UPDATE RefreshToken token
			SET token.revokedAt = :revokedAt
			WHERE token.userId = :userId
			  AND token.revokedAt IS NULL
			""")
	int revokeAllActiveByUserId(
			@Param("userId") UUID userId,
			@Param("revokedAt") java.time.Instant revokedAt);
}
