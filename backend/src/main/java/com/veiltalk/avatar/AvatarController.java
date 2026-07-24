package com.veiltalk.avatar;

import java.util.List;
import java.util.UUID;

import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RestController;

import jakarta.validation.Valid;

@RestController
public class AvatarController {

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

	@PutMapping("/avatars/me")
	ResponseEntity<Void> upsert(
			Authentication authentication,
			@Valid @RequestBody AvatarUpsertRequest request) {
		AvatarService.UpsertResult result = avatarService.upsert(
				(UUID) authentication.getPrincipal(),
				request);
		return ResponseEntity.status(result.created() ? HttpStatus.CREATED : HttpStatus.OK).build();
	}

	record AvatarModelsResponse(List<AvatarModel> models) {
	}
}
