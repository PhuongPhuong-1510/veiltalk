package com.veiltalk.video;

import com.fasterxml.jackson.annotation.JsonProperty;

import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;

public record ChunkUrlRequest(
		@NotBlank @JsonProperty("upload_id") String uploadId,
		// Endpoint /chunks luôn xin part ≥ 2 (part 1 đã cấp URL ở POST /videos).
		@NotNull @Min(2) @JsonProperty("part_number") Integer partNumber,
		// ETag MinIO trả về khi PUT part trước — thuộc về part (part_number - 1).
		@NotBlank @JsonProperty("etag_previous") String etagPrevious) {
}
