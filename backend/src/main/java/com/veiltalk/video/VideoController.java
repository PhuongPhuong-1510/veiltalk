package com.veiltalk.video;

import java.util.UUID;

import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import jakarta.validation.Valid;

@RestController
public class VideoController {

	private final VideoService videoService;

	public VideoController(VideoService videoService) {
		this.videoService = videoService;
	}

	@GetMapping("/videos")
	ResponseEntity<VideoLibraryResponse> list(
			Authentication authentication,
			@RequestParam(name = "cursor", required = false) String cursor,
			@RequestParam(name = "limit", required = false, defaultValue = "20") int limit,
			@RequestParam(name = "status", required = false) String status) {
		return ResponseEntity.ok(videoService.listVideos(
				(UUID) authentication.getPrincipal(), status, cursor, limit));
	}

	@GetMapping("/videos/{id}")
	ResponseEntity<VideoDetailResponse> get(
			Authentication authentication,
			@PathVariable("id") UUID videoId) {
		return ResponseEntity.ok(videoService.getVideo(
				(UUID) authentication.getPrincipal(), videoId));
	}

	@PutMapping("/videos/{id}")
	ResponseEntity<VideoDetailResponse> rename(
			Authentication authentication,
			@PathVariable("id") UUID videoId,
			@Valid @RequestBody RenameVideoRequest request) {
		return ResponseEntity.ok(videoService.renameVideo(
				(UUID) authentication.getPrincipal(), videoId, request));
	}

	@DeleteMapping("/videos/{id}")
	ResponseEntity<Void> delete(
			Authentication authentication,
			@PathVariable("id") UUID videoId) {
		videoService.deleteVideo((UUID) authentication.getPrincipal(), videoId);
		return ResponseEntity.noContent().build();
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

	@PostMapping("/videos/{id}/finalize")
	ResponseEntity<FinalizeVideoResponse> finalizeUpload(
			Authentication authentication,
			@PathVariable("id") UUID videoId,
			@Valid @RequestBody FinalizeVideoRequest request) {
		return ResponseEntity.accepted().body(videoService.finalizeUpload(
				(UUID) authentication.getPrincipal(), videoId, request));
	}

	@PostMapping("/videos/{id}/abort")
	ResponseEntity<Void> abortUpload(
			Authentication authentication,
			@PathVariable("id") UUID videoId,
			@Valid @RequestBody AbortVideoRequest request) {
		videoService.abortUpload((UUID) authentication.getPrincipal(), videoId, request);
		return ResponseEntity.noContent().build();
	}
}
