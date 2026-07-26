package com.veiltalk.call;

import java.nio.charset.StandardCharsets;
import java.util.UUID;

/**
 * Sinh call_session_id xác định (deterministic) từ cặp (callerId, calleeId), không lưu DB
 * hay giữ Map riêng — cùng một cặp user luôn cho cùng một id, bất kể ai gọi ai trước.
 */
final class CallSessionIdGenerator {

	private CallSessionIdGenerator() {
	}

	static UUID generate(UUID callerId, UUID calleeId) {
		String first = callerId.toString();
		String second = calleeId.toString();
		String normalized = first.compareTo(second) < 0
				? first + ":" + second
				: second + ":" + first;
		return UUID.nameUUIDFromBytes(normalized.getBytes(StandardCharsets.UTF_8));
	}
}
