package com.veiltalk.avatar;

import java.io.IOException;
import java.io.InputStream;
import java.util.List;

import org.springframework.core.io.ClassPathResource;
import org.springframework.stereotype.Service;

import com.fasterxml.jackson.databind.ObjectMapper;

@Service
public class AvatarModelCatalogService {

	private static final String CATALOG_PATH = "avatar-models.json";

	private final List<AvatarModel> models;

	public AvatarModelCatalogService(ObjectMapper objectMapper) {
		try (InputStream input = new ClassPathResource(CATALOG_PATH).getInputStream()) {
			Catalog catalog = objectMapper.readValue(input, Catalog.class);
			this.models = validate(catalog);
		}
		catch (IOException | RuntimeException exception) {
			throw new IllegalStateException("Cannot load avatar model catalog", exception);
		}
	}

	public List<AvatarModel> getModels() {
		return models;
	}

	private List<AvatarModel> validate(Catalog catalog) {
		if (catalog.models() == null || catalog.models().size() < 6) {
			throw new IllegalStateException("Avatar model catalog must contain at least six models");
		}
		for (AvatarModel model : catalog.models()) {
			if (model.id() == null || model.id().isBlank()
					|| model.name() == null || model.name().isBlank()
					|| model.modelUrl() == null || model.modelUrl().isBlank()
					|| model.thumbnailUrl() == null || model.thumbnailUrl().isBlank()
					|| model.supportedCustomizations() == null
					|| model.outfitOptions() == null) {
				throw new IllegalStateException("Avatar model catalog contains an incomplete model");
			}
		}
		return List.copyOf(catalog.models());
	}

	private record Catalog(List<AvatarModel> models) {
	}
}
