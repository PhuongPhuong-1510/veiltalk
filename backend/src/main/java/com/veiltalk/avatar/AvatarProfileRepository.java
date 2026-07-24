package com.veiltalk.avatar;

import java.util.Optional;
import java.util.UUID;

import org.springframework.data.jpa.repository.JpaRepository;

public interface AvatarProfileRepository extends JpaRepository<AvatarProfile, UUID> {

	boolean existsByUserId(UUID userId);

	Optional<AvatarProfile> findByUserId(UUID userId);
}
