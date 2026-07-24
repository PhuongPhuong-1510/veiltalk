package com.veiltalk.auth;

import java.util.Optional;
import java.util.UUID;

import org.springframework.data.jpa.repository.JpaRepository;

public interface UserRepository extends JpaRepository<User, UUID> {

	Optional<User> findByIdAndDeletedAtIsNull(UUID id);

	Optional<User> findByEmailAndDeletedAtIsNull(String email);

	Optional<User> findByEmailAndIsDiscoverableTrueAndDeletedAtIsNull(String email);
}
