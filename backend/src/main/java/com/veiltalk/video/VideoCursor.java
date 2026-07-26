package com.veiltalk.video;

import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.Base64;
import java.util.UUID;

import com.veiltalk.auth.ValidationException;

/**
 * Cursor cho GET /videos (mục 7.1): mã hóa (created_at, id) của bản ghi cuối trang trước.
 * created_at không đảm bảo duy nhất nên id làm tie-breaker, khớp ORDER BY trong
 * {@link VideoRepository#findLibraryPage}.
 */
record VideoCursor(Instant createdAt, UUID id) {

	static VideoCursor decode(String cursor) {
		if (cursor == null || cursor.isBlank()) {
			return null;
		}
		try {
			String raw = new String(Base64.getUrlDecoder().decode(cursor), StandardCharsets.UTF_8);
			int separator = raw.indexOf('|');
			return new VideoCursor(
					Instant.parse(raw.substring(0, separator)),
					UUID.fromString(raw.substring(separator + 1)));
		} catch (RuntimeException exception) {
			throw new ValidationException("cursor không hợp lệ.");
		}
	}

	static String encode(Video video) {
		String raw = video.getCreatedAt() + "|" + video.getId();
		return Base64.getUrlEncoder().withoutPadding()
				.encodeToString(raw.getBytes(StandardCharsets.UTF_8));
	}
}
