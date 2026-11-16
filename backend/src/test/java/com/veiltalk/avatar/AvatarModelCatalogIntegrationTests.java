package com.veiltalk.avatar;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.web.servlet.MockMvc;

@SpringBootTest
@AutoConfigureMockMvc
class AvatarModelCatalogIntegrationTests {

	@Autowired
	private MockMvc mockMvc;

	@Autowired
	private AvatarModelCatalogService catalogService;

	@Test
	void tc10ReturnsTheTenLocalVrmModels() throws Exception {
		mockMvc.perform(get("/avatars/models"))
				.andExpect(status().isOk())
				.andExpect(jsonPath("$.models.length()").value(10))
				.andExpect(jsonPath("$.models[0].id").value("reference-avatar-2"))
				.andExpect(jsonPath("$.models[9].id").value("reference-avatar-11"))
				.andExpect(jsonPath("$.models[*].id").exists())
				.andExpect(jsonPath("$.models[*].name").exists())
				.andExpect(jsonPath("$.models[*].model_url").exists())
				.andExpect(jsonPath("$.models[*].thumbnail_url").exists())
				.andExpect(jsonPath("$.models[*].supported_customizations").exists())
				.andExpect(jsonPath("$.models[*].outfit_options").exists())
				.andExpect(jsonPath("$.models[*].model_id").doesNotExist());

		assertThat(catalogService.getModels())
				.hasSize(10)
				.allSatisfy(model -> {
					assertThat(model.id()).isNotBlank();
					assertThat(model.name()).isNotBlank();
					assertThat(model.modelUrl()).isNotBlank();
					assertThat(model.thumbnailUrl()).isNotBlank();
					assertThat(model.supportedCustomizations()).isNotNull();
					assertThat(model.outfitOptions()).isNotNull();
				});
	}
}
