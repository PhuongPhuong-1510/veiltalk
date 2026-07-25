package com.veiltalk.video;

import java.util.UUID;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

public interface VideoRepository extends JpaRepository<Video, UUID> {

	// Tổng dung lượng đã dùng của user (NFR-19): chỉ tính video status='ready',
	// bỏ qua bản ghi đã xóa mềm. Video recording/processing/failed không tính vào quota.
	@Query("SELECT COALESCE(SUM(v.fileSizeBytes), 0) FROM Video v "
			+ "WHERE v.userId = :userId AND v.status = com.veiltalk.video.VideoStatus.READY "
			+ "AND v.deletedAt IS NULL")
	long sumReadyFileSizeBytes(@Param("userId") UUID userId);
}
