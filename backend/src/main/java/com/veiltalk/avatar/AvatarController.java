package com.veiltalk.avatar;

import java.util.List;
import java.util.UUID;

import org.springframework.http.HttpStatus;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestPart;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.multipart.MultipartFile;

@RestController
public class AvatarController {
	private static final String CROSS_ORIGIN_RESOURCE_POLICY = "Cross-Origin-Resource-Policy";

	private final AvatarModelCatalogService catalogService;
	private final AvatarService avatarService;

	public AvatarController(
			AvatarModelCatalogService catalogService,
			AvatarService avatarService) {
		this.catalogService = catalogService;
		this.avatarService = avatarService;
	}

	@GetMapping("/avatars/models")
	AvatarModelsResponse getModels() {
		return new AvatarModelsResponse(catalogService.getModels());
	}

	@PutMapping(path = "/avatars/me/complete", consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
	AvatarCompleteResponse complete(Authentication authentication,
			@RequestParam("request_id") UUID requestId,
			@RequestParam(value = "expected_revision", required = false) UUID expectedRevision,
			@RequestParam("model_id") String modelId,
			@RequestParam("customizations") String customizations,
			@RequestPart("portrait") MultipartFile portrait) throws java.io.IOException {
		return avatarService.complete((UUID) authentication.getPrincipal(), requestId, expectedRevision,
				modelId, customizations, portrait.getBytes());
	}

	@GetMapping("/avatars/me")
	AvatarProfileResponse getOwnAvatar(Authentication authentication) {
		return avatarService.getOwnAvatar((UUID) authentication.getPrincipal());
	}

	@GetMapping("/avatars/{userId}")
	AvatarPublicResponse getUserAvatar(@PathVariable UUID userId) {
		return avatarService.getUserAvatar(userId);
	}

	@GetMapping(value = "/avatars/{userId}/portrait", produces = MediaType.IMAGE_PNG_VALUE)
	ResponseEntity<byte[]> getPortrait(@PathVariable UUID userId,
			@RequestHeader(value = HttpHeaders.IF_NONE_MATCH, required = false) String ifNoneMatch) {
		AvatarService.Portrait portrait = avatarService.portrait(userId);
		String etag = "\"" + portrait.version() + "\"";
		if (etag.equals(ifNoneMatch)) return ResponseEntity.status(HttpStatus.NOT_MODIFIED)
				.header(CROSS_ORIGIN_RESOURCE_POLICY, "cross-origin")
				.header(HttpHeaders.CACHE_CONTROL, "public, no-cache")
				.eTag(etag)
				.build();
		return ResponseEntity.ok().contentType(MediaType.IMAGE_PNG)
				.header(CROSS_ORIGIN_RESOURCE_POLICY, "cross-origin")
				.header(HttpHeaders.CACHE_CONTROL, "public, no-cache")
				.eTag(etag)
				.body(portrait.bytes());
	}

	record AvatarModelsResponse(List<AvatarModel> models) {
	}
}
