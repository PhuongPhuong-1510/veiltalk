package com.veiltalk.video;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.OptionalLong;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.TimeUnit;

import org.springframework.stereotype.Component;

import io.minio.GetPresignedObjectUrlArgs;
import io.minio.ListPartsResponse;
import io.minio.MinioAsyncClient;
import io.minio.RemoveObjectArgs;
import io.minio.StatObjectArgs;
import io.minio.errors.ErrorResponseException;
import io.minio.http.Method;
import io.minio.messages.Part;

@Component
public class MinioMultipartStorage implements VideoMultipartStorage {

	// Hạn presigned GET URL để phát video ready — cố định 1 giờ theo API Design mục 7.7,
	// không cấu hình được (khác presignedUrlExpirySeconds vốn dùng cho part PUT lúc quay).
	private static final int VIEW_URL_EXPIRY_SECONDS = 3600;

	private final MinioAsyncClient minioAsyncClient;
	private final MinioProperties minioProperties;
	private final VideoProperties videoProperties;

	MinioMultipartStorage(
			MinioAsyncClient minioAsyncClient,
			MinioProperties minioProperties,
			VideoProperties videoProperties) {
		this.minioAsyncClient = minioAsyncClient;
		this.minioProperties = minioProperties;
		this.videoProperties = videoProperties;
	}

	@Override
	public String createMultipartUpload(String objectKey) {
		try {
			// region/headers/extraQueryParams = null: mặc định theo endpoint, không thêm header.
			return minioAsyncClient
					.createMultipartUploadAsync(minioProperties.bucket(), null, objectKey, null, null)
					.get()
					.result()
					.uploadId();
		} catch (InterruptedException exception) {
			Thread.currentThread().interrupt();
			throw new VideoStorageException("Bị gián đoạn khi khởi tạo multipart upload", exception);
		} catch (ExecutionException exception) {
			throw new VideoStorageException("Không thể khởi tạo multipart upload trên MinIO",
					exception.getCause() == null ? exception : exception.getCause());
		} catch (Exception exception) {
			throw new VideoStorageException("Không thể khởi tạo multipart upload trên MinIO", exception);
		}
	}

	@Override
	public String presignPartUrl(String objectKey, String uploadId, int partNumber) {
		try {
			// uploadId + partNumber trong query là bắt buộc để MinIO ghi nhận đây là part
			// của phiên multipart, dùng chung objectKey với lúc createMultipartUpload.
			return minioAsyncClient.getPresignedObjectUrl(GetPresignedObjectUrlArgs.builder()
					.method(Method.PUT)
					.bucket(minioProperties.bucket())
					.object(objectKey)
					.extraQueryParams(Map.of(
							"uploadId", uploadId,
							"partNumber", String.valueOf(partNumber)))
					.expiry((int) videoProperties.presignedUrlExpirySeconds(), TimeUnit.SECONDS)
					.build());
		} catch (Exception exception) {
			throw new VideoStorageException("Không thể tạo presigned URL cho part", exception);
		}
	}

	@Override
	public String presignGetUrl(String objectKey) {
		try {
			return minioAsyncClient.getPresignedObjectUrl(GetPresignedObjectUrlArgs.builder()
					.method(Method.GET)
					.bucket(minioProperties.bucket())
					.object(objectKey)
					.expiry(VIEW_URL_EXPIRY_SECONDS, TimeUnit.SECONDS)
					.build());
		} catch (Exception exception) {
			throw new VideoStorageException("Không thể tạo presigned URL để phát video", exception);
		}
	}

	@Override
	public List<UploadedPart> listParts(String objectKey, String uploadId) {
		try {
			List<UploadedPart> parts = new ArrayList<>();
			int marker = 0;
			boolean truncated;
			do {
				ListPartsResponse response = minioAsyncClient
						.listPartsAsync(minioProperties.bucket(), null, objectKey, 1000, marker,
								uploadId, null, null)
						.get();
				response.result().partList().forEach(part ->
						parts.add(new UploadedPart(part.partNumber(), part.etag(), part.partSize())));
				truncated = response.result().isTruncated();
				marker = response.result().nextPartNumberMarker();
			} while (truncated);
			return List.copyOf(parts);
		} catch (InterruptedException exception) {
			Thread.currentThread().interrupt();
			throw new VideoStorageException("Bị gián đoạn khi đọc danh sách multipart", exception);
		} catch (ExecutionException exception) {
			throw storageFailure("Không thể đọc danh sách multipart trên MinIO", exception);
		} catch (Exception exception) {
			throw new VideoStorageException("Không thể đọc danh sách multipart trên MinIO", exception);
		}
	}

	@Override
	public void completeMultipartUpload(String objectKey, String uploadId, List<UploadedPart> parts) {
		try {
			Part[] minioParts = parts.stream()
					.map(part -> new Part(part.partNumber(), part.etag()))
					.toArray(Part[]::new);
			minioAsyncClient.completeMultipartUploadAsync(
					minioProperties.bucket(), null, objectKey, uploadId, minioParts, null, null).get();
		} catch (InterruptedException exception) {
			Thread.currentThread().interrupt();
			throw new VideoStorageException("Bị gián đoạn khi hoàn tất multipart upload", exception);
		} catch (ExecutionException exception) {
			throw storageFailure("Không thể hoàn tất multipart upload trên MinIO", exception);
		} catch (Exception exception) {
			throw new VideoStorageException("Không thể hoàn tất multipart upload trên MinIO", exception);
		}
	}

	@Override
	public OptionalLong statObjectSize(String objectKey) {
		try {
			long size = minioAsyncClient.statObject(StatObjectArgs.builder()
					.bucket(minioProperties.bucket())
					.object(objectKey)
					.build()).get().size();
			return OptionalLong.of(size);
		} catch (InterruptedException exception) {
			Thread.currentThread().interrupt();
			throw new VideoStorageException("Bị gián đoạn khi kiểm tra object video", exception);
		} catch (ExecutionException exception) {
			Throwable cause = exception.getCause();
			if (cause instanceof ErrorResponseException error
					&& "NoSuchKey".equals(error.errorResponse().code())) {
				return OptionalLong.empty();
			}
			throw storageFailure("Không thể kiểm tra object video trên MinIO", exception);
		} catch (Exception exception) {
			throw new VideoStorageException("Không thể kiểm tra object video trên MinIO", exception);
		}
	}

	@Override
	public void abortMultipartUpload(String objectKey, String uploadId) {
		try {
			minioAsyncClient.abortMultipartUploadAsync(
					minioProperties.bucket(), null, objectKey, uploadId, null, null).get();
		} catch (InterruptedException exception) {
			Thread.currentThread().interrupt();
			throw new VideoStorageException("Bị gián đoạn khi hủy multipart upload", exception);
		} catch (ExecutionException exception) {
			// NoSuchUpload: multipart đã bị abort/complete trước đó (retry idempotent) —
			// coi như thành công thay vì báo lỗi để job retry không lặp vô hạn.
			Throwable cause = exception.getCause();
			if (cause instanceof ErrorResponseException error
					&& "NoSuchUpload".equals(error.errorResponse().code())) {
				return;
			}
			throw storageFailure("Không thể hủy multipart upload trên MinIO", exception);
		} catch (Exception exception) {
			throw new VideoStorageException("Không thể hủy multipart upload trên MinIO", exception);
		}
	}

	@Override
	public void removeObject(String objectKey) {
		try {
			minioAsyncClient.removeObject(RemoveObjectArgs.builder()
					.bucket(minioProperties.bucket())
					.object(objectKey)
					.build()).get();
		} catch (InterruptedException exception) {
			Thread.currentThread().interrupt();
			throw new VideoStorageException("Bị gián đoạn khi xóa object video", exception);
		} catch (ExecutionException exception) {
			throw storageFailure("Không thể xóa object video trên MinIO", exception);
		} catch (Exception exception) {
			throw new VideoStorageException("Không thể xóa object video trên MinIO", exception);
		}
	}

	private VideoStorageException storageFailure(String message, ExecutionException exception) {
		return new VideoStorageException(message,
				exception.getCause() == null ? exception : exception.getCause());
	}
}
