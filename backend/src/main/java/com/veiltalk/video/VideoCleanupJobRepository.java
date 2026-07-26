package com.veiltalk.video;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

public interface VideoCleanupJobRepository extends JpaRepository<VideoCleanupJob, UUID> {

	@Query("SELECT j FROM VideoCleanupJob j "
			+ "WHERE j.status = com.veiltalk.video.VideoCleanupJobStatus.PENDING "
			+ "AND j.nextAttemptAt <= :now ORDER BY j.nextAttemptAt ASC")
	List<VideoCleanupJob> findDue(@Param("now") Instant now);
}
