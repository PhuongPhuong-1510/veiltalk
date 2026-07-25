package com.veiltalk.video;

import java.util.UUID;

import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RestController;

import jakarta.validation.Valid;

@RestController
public class VideoController {

	private final VideoService videoService;

	public VideoController(VideoService videoService) {
		this.videoService = videoService;
	}

	@PostMapping("/videos")
	ResponseEntity<CreateVideoResponse> create(
			Authentication authentication,
			@Valid @RequestBody CreateVideoRequest request) {
		CreateVideoResponse response = videoService.initiateUpload(
				(UUID) authentication.getPrincipal(),
				request);
		return ResponseEntity.status(HttpStatus.CREATED).body(response);
	}

	@PostMapping("/videos/{id}/chunks")
	ResponseEntity<ChunkUrlResponse> requestNextChunk(
			Authentication authentication,
			@PathVariable("id") UUID videoId,
			@Valid @RequestBody ChunkUrlRequest request) {
		ChunkUrlResponse response = videoService.requestNextChunk(
				(UUID) authentication.getPrincipal(),
				videoId,
				request);
		return ResponseEntity.ok(response);
	}
}
