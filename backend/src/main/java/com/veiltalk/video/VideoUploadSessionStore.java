package com.veiltalk.video;

import java.util.Map;
import java.util.Optional;
import java.util.UUID;

/**
 * State tạm của một phiên multipart upload (video:upload:{videoId} trong Redis).
 *
 * <p>Chết khi finalize/abort hoặc TTL hết hạn — MinIO mới giữ bytes thật, đây chỉ là
 * sổ ghi ETag theo part để dùng lại ở bước finalize (P2-T22). Tách interface để test
 * tầng service có thể mock; kiểm chứng Lua chạy thật đặt ở integration test với Redis thật.
 */
public interface VideoUploadSessionStore {

	/**
	 * Gieo phiên ngay sau khi tạo record video (P2-T20). Đặt nextPartNumber = 2 vì part 1
	 * đã được cấp URL ở lúc initiate; endpoint /chunks luôn xin part ≥ 2.
	 */
	void createSession(UUID videoId, String uploadId, UUID userId, long chunkSizeBytes);

	/**
	 * Kiểm tra thứ tự + idempotency + quota rồi cập nhật state một cách NGUYÊN TỬ (Lua).
	 * ETag của request part K thuộc về part K-1 (part vừa PUT xong).
	 *
	 * @param readyBytes         tổng dung lượng video 'ready' của user (từ DB)
	 * @param storageLimitBytes  hạn mức quota mỗi tài khoản (NFR-19)
	 */
	ReserveResult reserveNextPart(
			UUID videoId,
			String uploadId,
			int partNumber,
			String etagPrevious,
			long readyBytes,
			long storageLimitBytes);

	Optional<UploadSession> findSession(UUID videoId);

	void deleteSession(UUID videoId);

	record UploadSession(String uploadId, UUID userId, long chunkSizeBytes,
			int nextPartNumber, Map<Integer, String> etags) {
	}

	/**
	 * Kết quả của reserveNextPart — service ánh xạ sang HTTP.
	 *
	 * <ul>
	 *   <li>{@link #OK} — lưu etag:{K-1}, tăng nextPartNumber, cấp URL part K (200)</li>
	 *   <li>{@link #RETRY} — K &lt; nextPartNumber và ETag khớp: retry hợp lệ, cấp lại URL (200)</li>
	 *   <li>{@link #ERR_NO_SESSION} — phiên không tồn tại/hết hạn (404)</li>
	 *   <li>{@link #ERR_UPLOAD} — upload_id không khớp phiên (400)</li>
	 *   <li>{@link #ERR_QUOTA} — ước lượng bảo thủ vượt hạn mức (507)</li>
	 *   <li>{@link #ERR_ETAG} — K &lt; nextPartNumber nhưng ETag khác đã lưu (400)</li>
	 *   <li>{@link #ERR_ORDER} — K &gt; nextPartNumber, nhảy cóc (400)</li>
	 * </ul>
	 */
	enum ReserveResult {
		OK,
		RETRY,
		ERR_NO_SESSION,
		ERR_UPLOAD,
		ERR_QUOTA,
		ERR_ETAG,
		ERR_ORDER
	}
}
