package com.veiltalk.video;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

public record RenameVideoRequest(
		@NotBlank @Size(min = 1, max = 255) String title) {
}
