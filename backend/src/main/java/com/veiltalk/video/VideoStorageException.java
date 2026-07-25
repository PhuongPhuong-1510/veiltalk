package com.veiltalk.video;

/**
 * Lỗi khi thao tác với MinIO (multipart upload, presign). Là unchecked exception —
 * không map sang mã lỗi nghiệp vụ cụ thể; để handler mặc định trả 500 vì đây là lỗi hạ tầng.
 */
public class VideoStorageException extends RuntimeException {

	public VideoStorageException(String message, Throwable cause) {
		super(message, cause);
	}
}
