package com.veiltalk.avatar;

import java.util.Collection;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

import org.springframework.data.jpa.repository.JpaRepository;

public interface AvatarProfileRepository extends JpaRepository<AvatarProfile, UUID> {

	boolean existsByUserId(UUID userId);

	Optional<AvatarProfile> findByUserId(UUID userId);

	List<AvatarProfile> findAllByUserIdIn(Collection<UUID> userIds);

	boolean existsByPortraitObjectKey(String portraitObjectKey);
}
