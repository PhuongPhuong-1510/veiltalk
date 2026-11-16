package com.veiltalk.auth;

import java.util.Optional;
import java.util.UUID;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import jakarta.persistence.LockModeType;

public interface UserRepository extends JpaRepository<User, UUID> {

	Optional<User> findByIdAndDeletedAtIsNull(UUID id);

	Optional<User> findByEmailAndDeletedAtIsNull(String email);

	Optional<User> findByEmailAndIsDiscoverableTrueAndDeletedAtIsNull(String email);

	Optional<User> findByUsername(String username);

	@Lock(LockModeType.PESSIMISTIC_WRITE)
	@Query("SELECT u FROM User u WHERE u.id = :id AND u.deletedAt IS NULL")
	Optional<User> findActiveByIdForUpdate(@Param("id") UUID id);
}
