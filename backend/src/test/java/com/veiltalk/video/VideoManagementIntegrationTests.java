package com.veiltalk.video;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.BDDMockito.given;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.util.UUID;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.transaction.annotation.Transactional;

import com.veiltalk.auth.JwtService;
import com.veiltalk.auth.User;
import com.veiltalk.auth.UserRepository;

/**
 * P2-T24 — TC-34 (đổi tên), TC-35 (xóa video ready giảm quota), TC-36 (video failed
 * view_url null). API Design mục 7.7–7.9.
 */
@SpringBootTest
@AutoConfigureMockMvc
@Transactional
class VideoManagementIntegrationTests {

	private static final String VIEW_URL = "https://minio.internal/veiltalk/videos/x/demo.mp4?signed";

	@Autowired
	private MockMvc mockMvc;
	@Autowired
	private UserRepository userRepository;
	@Autowired
	private VideoRepository videoRepository;
	@Autowired
	private JwtService jwtService;

	@MockitoBean
	private VideoMultipartStorage multipartStorage;

	private User user;
	private String token;

	@BeforeEach
	void setUp() {
		user = createUser();
		token = jwtService.generateAccessToken(user.getId(), user.getRole());
	}

	@Test
	void tc34RenamesVideoRegardlessOfStatus() throws Exception {
		Video video = seedVideo(VideoStatus.READY, 1_048_576L);

		mockMvc.perform(put("/videos/" + video.getId())
						.header("Authorization", "Bearer " + token)
						.contentType(MediaType.APPLICATION_JSON)
						.content("{\"title\":\"Tên mới\"}"))
				.andExpect(status().isOk())
				.andExpect(jsonPath("$.title").value("Tên mới"));

		assertThat(videoRepository.findById(video.getId()).orElseThrow().getTitle())
				.isEqualTo("Tên mới");
	}

	@Test
	void renameRejectsBlankTitleAndForeignVideo() throws Exception {
		Video video = seedVideo(VideoStatus.READY, 1_048_576L);

		mockMvc.perform(put("/videos/" + video.getId())
						.header("Authorization", "Bearer " + token)
						.contentType(MediaType.APPLICATION_JSON)
						.content("{\"title\":\"\"}"))
				.andExpect(status().isBadRequest())
				.andExpect(jsonPath("$.error.code").value("VALIDATION_ERROR"));

		User otherUser = createUser();
		String otherToken = jwtService.generateAccessToken(otherUser.getId(), otherUser.getRole());
		mockMvc.perform(put("/videos/" + video.getId())
						.header("Authorization", "Bearer " + otherToken)
						.contentType(MediaType.APPLICATION_JSON)
						.content("{\"title\":\"Trộm tên\"}"))
				.andExpect(status().isForbidden());
	}

	@Test
	void tc35DeletesReadyVideoAndReducesStorageUsedImmediately() throws Exception {
		Video video = seedVideo(VideoStatus.READY, 10_485_760L);

		mockMvc.perform(get("/videos")
						.header("Authorization", "Bearer " + token))
				.andExpect(status().isOk())
				.andExpect(jsonPath("$.storage_used_bytes").value(10_485_760L));

		mockMvc.perform(delete("/videos/" + video.getId())
						.header("Authorization", "Bearer " + token))
				.andExpect(status().isNoContent());

		assertThat(videoRepository.findById(video.getId()).orElseThrow().getDeletedAt())
				.isNotNull();
		mockMvc.perform(get("/videos/" + video.getId())
						.header("Authorization", "Bearer " + token))
				.andExpect(status().isNotFound());
		mockMvc.perform(get("/videos")
						.header("Authorization", "Bearer " + token))
				.andExpect(status().isOk())
				.andExpect(jsonPath("$.storage_used_bytes").value(0));
	}

	@Test
	void tc36FailedVideoHasNullViewUrlAndZeroSize() throws Exception {
		Video video = seedVideo(VideoStatus.FAILED, 0L);

		mockMvc.perform(get("/videos/" + video.getId())
						.header("Authorization", "Bearer " + token))
				.andExpect(status().isOk())
				.andExpect(jsonPath("$.status").value("failed"))
				.andExpect(jsonPath("$.view_url").doesNotExist())
				.andExpect(jsonPath("$.file_size_bytes").value(0));
	}

	@Test
	void readyVideoReturnsPresignedViewUrl() throws Exception {
		Video video = seedVideo(VideoStatus.READY, 1_048_576L);
		given(multipartStorage.presignGetUrl(video.getStoragePath())).willReturn(VIEW_URL);

		mockMvc.perform(get("/videos/" + video.getId())
						.header("Authorization", "Bearer " + token))
				.andExpect(status().isOk())
				.andExpect(jsonPath("$.status").value("ready"))
				.andExpect(jsonPath("$.view_url").value(VIEW_URL));
	}

	@Test
	void getRejectsForeignVideoWith403AndMissingVideoWith404() throws Exception {
		Video video = seedVideo(VideoStatus.READY, 1_048_576L);
		User otherUser = createUser();
		String otherToken = jwtService.generateAccessToken(otherUser.getId(), otherUser.getRole());

		mockMvc.perform(get("/videos/" + video.getId())
						.header("Authorization", "Bearer " + otherToken))
				.andExpect(status().isForbidden());
		mockMvc.perform(get("/videos/" + UUID.randomUUID())
						.header("Authorization", "Bearer " + token))
				.andExpect(status().isNotFound());
	}

	private Video seedVideo(VideoStatus status, long bytes) {
		// file_size_bytes có CHECK > 0 (V1 schema) — video 'failed' vẫn lưu size ước tính lúc
		// quay dở, API tự trả về 0 ở response cho status=failed (VideoService.toDetailResponse).
		Video video = new Video();
		video.setUserId(user.getId());
		video.setTitle("P2-T24");
		video.setStoragePath("videos/" + UUID.randomUUID() + "/source.mp4");
		video.setFileSizeBytes(bytes > 0 ? bytes : 10_485_760L);
		video.setFormat("mp4");
		video.setStatus(status);
		return videoRepository.saveAndFlush(video);
	}

	private User createUser() {
		User newUser = new User();
		newUser.setEmail("t24-" + UUID.randomUUID() + "@example.com");
		newUser.setPasswordHash("test-only-hash");
		newUser.setDisplayName("P2-T24 user");
		return userRepository.saveAndFlush(newUser);
	}
}
