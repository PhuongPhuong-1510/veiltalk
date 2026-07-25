package com.veiltalk.video;

import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.util.StringUtils;

import com.veiltalk.auth.ValidationException;

@Service
public class VideoWebhookService {

	private static final Logger LOGGER = LoggerFactory.getLogger(VideoWebhookService.class);
	private static final String COMPLETE_MULTIPART_EVENT =
			"s3:ObjectCreated:CompleteMultipartUpload";

	private final VideoRepository videoRepository;
	private final MinioProperties minioProperties;

	public VideoWebhookService(VideoRepository videoRepository, MinioProperties minioProperties) {
		this.videoRepository = videoRepository;
		this.minioProperties = minioProperties;
	}

	@Transactional
	public void process(VideoWebhookRequest request) {
		List<ValidatedRecord> records = validateAll(request);
		for (ValidatedRecord record : records) {
			processOne(record);
		}
	}

	private List<ValidatedRecord> validateAll(VideoWebhookRequest request) {
		if (request == null || request.records() == null || request.records().isEmpty()) {
			throw new ValidationException("Webhook Records không được rỗng.");
		}
		List<ValidatedRecord> validated = new ArrayList<>(request.records().size());
		for (VideoWebhookRequest.NotificationRecord record : request.records()) {
			if (record == null
					|| !StringUtils.hasText(record.eventName())
					|| record.s3() == null
					|| record.s3().bucket() == null
					|| !StringUtils.hasText(record.s3().bucket().name())
					|| record.s3().object() == null
					|| !StringUtils.hasText(record.s3().object().key())
					|| record.s3().object().size() == null
					|| record.s3().object().size() <= 0) {
				throw new ValidationException("Webhook record không hợp lệ.");
			}
			String storagePath;
			try {
				storagePath = URLDecoder.decode(
						record.s3().object().key(), StandardCharsets.UTF_8);
			} catch (IllegalArgumentException exception) {
				throw new ValidationException("Webhook object key không hợp lệ.");
			}
			if (!StringUtils.hasText(storagePath)) {
				throw new ValidationException("Webhook object key không hợp lệ.");
			}
			validated.add(new ValidatedRecord(
					record.eventName(),
					record.s3().bucket().name(),
					storagePath,
					record.s3().object().size()));
		}
		return validated;
	}

	private void processOne(ValidatedRecord record) {
		if (!COMPLETE_MULTIPART_EVENT.equals(record.eventName())) {
			LOGGER.warn("Bỏ qua MinIO webhook event không hỗ trợ: {}", record.eventName());
			return;
		}
		if (!minioProperties.bucket().equals(record.bucket())) {
			LOGGER.warn("Bỏ qua MinIO webhook từ bucket không khớp: {}", record.bucket());
			return;
		}

		int updated = videoRepository.markReadyFromWebhook(record.storagePath(), record.fileSizeBytes());
		if (updated == 1) {
			return;
		}
		if (updated > 1) {
			throw new IllegalStateException("Nhiều video trùng storage_path");
		}

		videoRepository.findFirstByStoragePath(record.storagePath()).ifPresentOrElse(video -> {
			if (video.getStatus() == VideoStatus.PROCESSING
					&& video.getDeletedAt() == null
					&& video.getFileSizeBytes() != record.fileSizeBytes()) {
				LOGGER.warn("VIDEO_WEBHOOK_SIZE_MISMATCH videoId={} expectedBytes={} actualBytes={}",
						video.getId(), video.getFileSizeBytes(), record.fileSizeBytes());
			}
		}, () -> LOGGER.warn("Bỏ qua MinIO webhook không có metadata cho objectKey={}",
				record.storagePath()));
	}

	private record ValidatedRecord(
			String eventName,
			String bucket,
			String storagePath,
			long fileSizeBytes) {
	}
}
