package com.veiltalk.video;

import java.util.List;

import com.fasterxml.jackson.annotation.JsonProperty;

import jakarta.validation.Valid;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotEmpty;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;

public record FinalizeVideoRequest(
		@NotBlank @JsonProperty("upload_id") String uploadId,
		@NotEmpty @Size(max = 10_000) List<@Valid @NotNull PartRequest> parts,
		@Min(1) @JsonProperty("duration_secs") int durationSecs) {

	public record PartRequest(
			@Min(1) @Max(10_000) @JsonProperty("part_number") int partNumber,
			@NotBlank String etag) {
	}
}
