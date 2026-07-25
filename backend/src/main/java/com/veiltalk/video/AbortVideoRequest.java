package com.veiltalk.video;

import com.fasterxml.jackson.annotation.JsonProperty;

import jakarta.validation.constraints.NotBlank;

public record AbortVideoRequest(@NotBlank @JsonProperty("upload_id") String uploadId) {
}
