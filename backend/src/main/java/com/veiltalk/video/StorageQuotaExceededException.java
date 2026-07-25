package com.veiltalk.video;

/**
 * Dung lượng lưu trữ của tài khoản không đủ để chứa video ước tính (NFR-19).
 * Map sang HTTP 507 Insufficient Storage, code STORAGE_QUOTA_EXCEEDED (xem docs/04_API.md).
 */
public class StorageQuotaExceededException extends RuntimeException {

	public StorageQuotaExceededException(String message) {
		super(message);
	}
}
