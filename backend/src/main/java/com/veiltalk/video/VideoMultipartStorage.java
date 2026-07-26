package com.veiltalk.video;

import java.util.List;
import java.util.OptionalLong;

/**
 * Trừu tượng hóa các thao tác MinIO multipart upload cho luồng quay video.
 *
 * <p>Tách interface để controller/service không phụ thuộc trực tiếp low-level
 * {@code MinioAsyncClient} — test tầng service/controller có thể mock, còn kiểm chứng
 * presign part thật được đặt trong integration test gate sau MinIO thật. Dùng lại cho
 * P2-T21 (chunk tiếp theo) và P2-T22 (finalize/abort).
 */
public interface VideoMultipartStorage {

	/**
	 * Khởi tạo multipart upload cho một object key, trả về upload_id của MinIO.
	 * upload_id gắn với cặp (bucket, objectKey) — mọi part và bước finalize/abort sau này
	 * phải dùng đúng cặp key + upload_id này.
	 */
	String createMultipartUpload(String objectKey);

	/**
	 * Sinh presigned PUT URL để client upload trực tiếp một part lên MinIO.
	 * URL phải kèm query {@code uploadId} và {@code partNumber} thì MinIO mới ghi nhận là
	 * part của phiên multipart (không phải object độc lập).
	 */
	String presignPartUrl(String objectKey, String uploadId, int partNumber);

	List<UploadedPart> listParts(String objectKey, String uploadId);

	void completeMultipartUpload(String objectKey, String uploadId, List<UploadedPart> parts);

	OptionalLong statObjectSize(String objectKey);

	void abortMultipartUpload(String objectKey, String uploadId);

	void removeObject(String objectKey);

	record UploadedPart(int partNumber, String etag, long sizeBytes) {
	}
}
