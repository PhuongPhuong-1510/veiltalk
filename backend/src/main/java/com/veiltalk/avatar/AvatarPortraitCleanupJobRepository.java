package com.veiltalk.avatar;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

public interface AvatarPortraitCleanupJobRepository extends JpaRepository<AvatarPortraitCleanupJob, UUID> {
	@Query("SELECT j FROM AvatarPortraitCleanupJob j WHERE j.nextAttemptAt <= :now ORDER BY j.nextAttemptAt")
	List<AvatarPortraitCleanupJob> findDue(@Param("now") Instant now);
}
