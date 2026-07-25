package com.veiltalk.video;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.transaction.annotation.Transactional;

public interface VideoRepository extends JpaRepository<Video, UUID> {

	// Tổng dung lượng đã dùng của user (NFR-19): chỉ tính video status='ready',
	// bỏ qua bản ghi đã xóa mềm. Video recording/processing/failed không tính vào quota.
	@Query("SELECT COALESCE(SUM(v.fileSizeBytes), 0) FROM Video v "
			+ "WHERE v.userId = :userId AND v.status = com.veiltalk.video.VideoStatus.READY "
			+ "AND v.deletedAt IS NULL")
	long sumReadyFileSizeBytes(@Param("userId") UUID userId);

	@Query("SELECT COALESCE(SUM(v.fileSizeBytes), 0) FROM Video v "
			+ "WHERE v.userId = :userId "
			+ "AND v.status IN (com.veiltalk.video.VideoStatus.READY, "
			+ "com.veiltalk.video.VideoStatus.PROCESSING) "
			+ "AND v.deletedAt IS NULL")
	long sumQuotaReservedBytes(@Param("userId") UUID userId);

	@Modifying(clearAutomatically = true, flushAutomatically = true)
	@Transactional
	@Query("UPDATE Video v SET v.status = com.veiltalk.video.VideoStatus.PROCESSING, "
			+ "v.durationSecs = :durationSecs, v.fileSizeBytes = :actualBytes "
			+ "WHERE v.id = :id AND v.status = com.veiltalk.video.VideoStatus.RECORDING "
			+ "AND v.deletedAt IS NULL")
	int markProcessing(@Param("id") UUID id, @Param("durationSecs") int durationSecs,
			@Param("actualBytes") long actualBytes);

	@Modifying(clearAutomatically = true, flushAutomatically = true)
	@Transactional
	@Query("UPDATE Video v SET v.status = com.veiltalk.video.VideoStatus.FAILED, "
			+ "v.deletedAt = :deletedAt WHERE v.id = :id "
			+ "AND v.status = com.veiltalk.video.VideoStatus.RECORDING "
			+ "AND v.deletedAt IS NULL")
	int failAndSoftDeleteRecording(@Param("id") UUID id, @Param("deletedAt") Instant deletedAt);

	@Modifying(clearAutomatically = true, flushAutomatically = true)
	@Transactional
	@Query("UPDATE Video v SET v.status = com.veiltalk.video.VideoStatus.FAILED "
			+ "WHERE v.id = :id AND v.status = com.veiltalk.video.VideoStatus.PROCESSING "
			+ "AND v.deletedAt IS NULL")
	int failProcessing(@Param("id") UUID id);

	@Query("SELECT v FROM Video v WHERE v.status = com.veiltalk.video.VideoStatus.PROCESSING "
			+ "AND v.deletedAt IS NULL AND v.updatedAt < :cutoff")
	List<Video> findTimedOutProcessing(@Param("cutoff") Instant cutoff);
}
