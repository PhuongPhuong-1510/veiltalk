package com.veiltalk.video;

import org.springframework.boot.context.properties.ConfigurationProperties;

@ConfigurationProperties(prefix = "video")
public record VideoProperties(
        long storageLimitBytes,
        // Vòng đời của một phiên multipart trong Redis (video:upload:{videoId}).
        // Refresh mỗi thao tác hợp lệ; hết hạn = phiên coi như bỏ dở, chunk tiếp theo trả 404.
        long uploadSessionTtlSeconds,
        // Một nguồn sự thật cho TTL presigned URL: MinioMultipartStorage ký URL VÀ
        // VideoService trả expires_in đều đọc giá trị này (khớp mô tả API mục 7.3).
        long presignedUrlExpirySeconds,
        long lockTtlMillis,
        long lockAcquireTimeoutMillis,
        long processingTimeoutSeconds,
        long cleanupIntervalSeconds,
        // P2-T24 — video_cleanup_jobs retry: nhân đôi mỗi lần thất bại, bắt đầu từ giá trị này.
        long cleanupJobInitialBackoffSeconds,
        // Số lần thử tối đa trước khi chuyển FAILED_PERMANENT (không tự xóa, cần ops rà soát).
        int cleanupJobMaxAttempts,
        // Chu kỳ quét video_cleanup_jobs của VideoCleanupRetryJob.
        long cleanupJobPollIntervalSeconds) {
}
