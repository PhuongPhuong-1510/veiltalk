package com.veiltalk.video;

import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/internal/videos")
public class VideoWebhookController {

	private final VideoWebhookService videoWebhookService;

	public VideoWebhookController(VideoWebhookService videoWebhookService) {
		this.videoWebhookService = videoWebhookService;
	}

	@PostMapping("/webhook")
	ResponseEntity<Void> receive(@RequestBody VideoWebhookRequest request) {
		videoWebhookService.process(request);
		return ResponseEntity.noContent().build();
	}
}
