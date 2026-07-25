package com.veiltalk.video;

import com.fasterxml.jackson.annotation.JsonProperty;

import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Positive;
import jakarta.validation.constraints.Size;

public record CreateVideoRequest(
		@NotBlank @Size(max = 255) String title,
		@NotNull @Positive @JsonProperty("estimated_size_bytes") Long estimatedSizeBytes,
		// Tối thiểu 5MB theo yêu cầu multipart của MinIO/S3 (part cuối được phép nhỏ hơn).
		@NotNull @Min(5_242_880L) @JsonProperty("chunk_size_bytes") Long chunkSizeBytes,
		@Size(max = 10) String format) {
}
