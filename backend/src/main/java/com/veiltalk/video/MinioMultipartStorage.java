package com.veiltalk.video;

import java.util.Map;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.TimeUnit;

import org.springframework.stereotype.Component;

import io.minio.GetPresignedObjectUrlArgs;
import io.minio.MinioAsyncClient;
import io.minio.http.Method;

@Component
public class MinioMultipartStorage implements VideoMultipartStorage {

	// Presigned part URL hết hạn sau 1 giờ — khớp expires_in mô tả ở API mục 7.3.
	private static final int PRESIGN_EXPIRY_SECONDS = 3600;

	private final MinioAsyncClient minioAsyncClient;
	private final MinioProperties minioProperties;

	MinioMultipartStorage(MinioAsyncClient minioAsyncClient, MinioProperties minioProperties) {
		this.minioAsyncClient = minioAsyncClient;
		this.minioProperties = minioProperties;
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
					.expiry(PRESIGN_EXPIRY_SECONDS, TimeUnit.SECONDS)
					.build());
		} catch (Exception exception) {
			throw new VideoStorageException("Không thể tạo presigned URL cho part", exception);
		}
	}
}
