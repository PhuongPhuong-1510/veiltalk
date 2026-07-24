package com.veiltalk.avatar;

import java.util.List;

import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
public class AvatarController {

	private final AvatarModelCatalogService catalogService;

	public AvatarController(AvatarModelCatalogService catalogService) {
		this.catalogService = catalogService;
	}

	@GetMapping("/avatars/models")
	AvatarModelsResponse getModels() {
		return new AvatarModelsResponse(catalogService.getModels());
	}

	record AvatarModelsResponse(List<AvatarModel> models) {
	}
}
