package com.veiltalk.video;

import java.util.UUID;

import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.util.StringUtils;

import jakarta.persistence.EntityManager;

@Service
public class VideoService {

	// Chunk đầu tiên của phiên multipart luôn là part số 1.
	private static final int FIRST_PART_NUMBER = 1;

	private final VideoRepository videoRepository;
	private final VideoMultipartStorage multipartStorage;
	private final VideoProperties videoProperties;
	private final EntityManager entityManager;

	public VideoService(
			VideoRepository videoRepository,
			VideoMultipartStorage multipartStorage,
			VideoProperties videoProperties,
			EntityManager entityManager) {
		this.videoRepository = videoRepository;
		this.multipartStorage = multipartStorage;
		this.videoProperties = videoProperties;
		this.entityManager = entityManager;
	}

	@Transactional
	public CreateVideoResponse initiateUpload(UUID userId, CreateVideoRequest request) {
		// 1) Quota (NFR-19): chỉ tính video status='ready'; recording/processing/failed không tính.
		long usedBytes = videoRepository.sumReadyFileSizeBytes(userId);
		if (usedBytes + request.estimatedSizeBytes() > videoProperties.storageLimitBytes()) {
			throw new StorageQuotaExceededException(
					"Dung lượng tài khoản không đủ để chứa video này. Hãy xóa bớt video cũ.");
		}

		String format = StringUtils.hasText(request.format()) ? request.format() : "mp4";

		// 2) Gọi MinIO TRƯỚC khi insert để nếu MinIO lỗi thì không sinh record 'recording' mồ côi.
		// objectKey phải cố định suốt phiên (create → upload part → finalize dùng chung key);
		// dùng một UUID riêng cho key, không phụ thuộc id do DB sinh.
		String storageKey = "videos/" + UUID.randomUUID() + "/source." + format;
		String uploadId = multipartStorage.createMultipartUpload(storageKey);
		String firstChunkUrl = multipartStorage.presignPartUrl(storageKey, uploadId, FIRST_PART_NUMBER);

		// 3) Tạo record videos status='recording'. file_size_bytes có CHECK > 0 nên lưu tạm
		// estimated (đã validate > 0); giá trị thật ghi đè khi webhook báo ready (P2-T23).
		Video video = new Video();
		video.setUserId(userId);
		video.setTitle(request.title());
		video.setStoragePath(storageKey);
		video.setFileSizeBytes(request.estimatedSizeBytes());
		video.setFormat(format);
		video.setStatus(VideoStatus.RECORDING);

		videoRepository.saveAndFlush(video);
		// created_at do DB sinh (insertable=false) — refresh để đọc lại giá trị.
		entityManager.refresh(video);

		return new CreateVideoResponse(
				video.getId(),
				video.getTitle(),
				video.getStatus().getDatabaseValue(),
				uploadId,
				firstChunkUrl,
				FIRST_PART_NUMBER,
				video.getCreatedAt());
	}
}
