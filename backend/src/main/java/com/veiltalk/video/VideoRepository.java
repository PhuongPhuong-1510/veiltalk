package com.veiltalk.video;

import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.transaction.annotation.Transactional;

public interface VideoRepository extends JpaRepository<Video, UUID> {

	Optional<Video> findFirstByStoragePath(String storagePath);

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
	@Query("UPDATE Video v SET v.status = com.veiltalk.video.VideoStatus.RECORDING "
			+ "WHERE v.id = :id AND v.status = com.veiltalk.video.VideoStatus.PROCESSING "
			+ "AND v.deletedAt IS NULL")
	int restoreRecording(@Param("id") UUID id);

	@Modifying(clearAutomatically = true, flushAutomatically = true)
	@Query("UPDATE Video v SET v.status = com.veiltalk.video.VideoStatus.READY "
			+ "WHERE v.storagePath = :storagePath "
			+ "AND v.status = com.veiltalk.video.VideoStatus.PROCESSING "
			+ "AND v.deletedAt IS NULL AND v.fileSizeBytes = :fileSizeBytes")
	int markReadyFromWebhook(
			@Param("storagePath") String storagePath,
			@Param("fileSizeBytes") long fileSizeBytes);

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

	@Query("SELECT v FROM Video v WHERE v.userId = :userId "
			+ "AND v.status = com.veiltalk.video.VideoStatus.RECORDING AND v.deletedAt IS NULL")
	List<Video> findRecordingByUserId(@Param("userId") UUID userId);

	// Cursor pagination (7.1): created_at DESC, id DESC làm tie-breaker vì created_at
	// không đảm bảo duy nhất. Cursor mã hóa (created_at, id) của bản ghi cuối trang trước.
	// CAST bắt buộc: PostgreSQL driver không tự suy ra kiểu tham số khi vế "IS NULL" đứng
	// một mình (không có ngữ cảnh kiểu khác) — lỗi "could not determine data type of parameter".
	@Query("SELECT v FROM Video v WHERE v.userId = :userId AND v.deletedAt IS NULL "
			+ "AND (CAST(:status AS com.veiltalk.video.VideoStatus) IS NULL OR v.status = :status) "
			+ "AND (CAST(:cursorCreatedAt AS java.time.Instant) IS NULL "
			+ "     OR v.createdAt < :cursorCreatedAt "
			+ "     OR (v.createdAt = :cursorCreatedAt AND v.id < :cursorId)) "
			+ "ORDER BY v.createdAt DESC, v.id DESC")
	List<Video> findLibraryPage(
			@Param("userId") UUID userId,
			@Param("status") VideoStatus status,
			@Param("cursorCreatedAt") Instant cursorCreatedAt,
			@Param("cursorId") UUID cursorId,
			Pageable pageable);

	@Modifying(clearAutomatically = true, flushAutomatically = true)
	@Transactional
	@Query("UPDATE Video v SET v.title = :title WHERE v.id = :id AND v.deletedAt IS NULL")
	int renameVideo(@Param("id") UUID id, @Param("title") String title);

	@Modifying(clearAutomatically = true, flushAutomatically = true)
	@Transactional
	@Query("UPDATE Video v SET v.deletedAt = :deletedAt WHERE v.id = :id AND v.deletedAt IS NULL")
	int softDeleteVideo(@Param("id") UUID id, @Param("deletedAt") Instant deletedAt);
}
