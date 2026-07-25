package com.veiltalk.video;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.BDDMockito.given;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.util.List;
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

@SpringBootTest
@AutoConfigureMockMvc
@Transactional
class VideoCreateIntegrationTests {

	private static final String UPLOAD_ID = "minio-multipart-upload-id";
	private static final String FIRST_CHUNK_URL =
			"https://minio.internal/veiltalk/videos/abc/source.mp4?uploadId=" + UPLOAD_ID
					+ "&partNumber=1&X-Amz-Signature=stub";

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

	@MockitoBean
	private VideoUploadSessionStore sessionStore;

	private User user;
	private String token;

	@BeforeEach
	void setUp() {
		user = createUser();
		token = jwtService.generateAccessToken(user.getId(), user.getRole());
	}

	@Test
	void tc29InitiatesMultipartUploadWhenQuotaAvailable() throws Exception {
		given(multipartStorage.createMultipartUpload(anyString())).willReturn(UPLOAD_ID);
		given(multipartStorage.presignPartUrl(anyString(), anyString(), anyInt()))
				.willReturn(FIRST_CHUNK_URL);

		mockMvc.perform(post("/videos")
						.header("Authorization", "Bearer " + token)
						.contentType(MediaType.APPLICATION_JSON)
						.content("""
								{"title":"Demo avatar","estimated_size_bytes":10485760,"chunk_size_bytes":5242880}
								"""))
				.andExpect(status().isCreated())
				.andExpect(jsonPath("$.id").isNotEmpty())
				.andExpect(jsonPath("$.title").value("Demo avatar"))
				.andExpect(jsonPath("$.status").value("recording"))
				.andExpect(jsonPath("$.upload_id").value(UPLOAD_ID))
				.andExpect(jsonPath("$.first_chunk_url").value(FIRST_CHUNK_URL))
				.andExpect(jsonPath("$.part_number").value(1))
				.andExpect(jsonPath("$.created_at").exists());

		List<Video> videos = videoRepository.findAll();
		assertThat(videos).hasSize(1);
		assertThat(videos.get(0).getStatus()).isEqualTo(VideoStatus.RECORDING);
		assertThat(videos.get(0).getUserId()).isEqualTo(user.getId());
		// T20 phải gieo phiên multipart để T21 tích lũy ETag.
		verify(sessionStore).createSession(
				videos.get(0).getId(), UPLOAD_ID, user.getId(), 5_242_880L);
	}

	@Test
	void tc33RejectsWhenEstimatedSizeExceedsQuota() throws Exception {
		// User đã có ~1.99GB video status='ready' → thêm 50MB sẽ vượt 2GB.
		seedReadyVideo(2_136_746_229L);

		mockMvc.perform(post("/videos")
						.header("Authorization", "Bearer " + token)
						.contentType(MediaType.APPLICATION_JSON)
						.content("""
								{"title":"Over quota","estimated_size_bytes":52428800,"chunk_size_bytes":5242880}
								"""))
				.andExpect(status().isInsufficientStorage())
				.andExpect(jsonPath("$.error.code").value("STORAGE_QUOTA_EXCEEDED"));

		// Không tạo record mới và không đụng tới MinIO khi quota vượt.
		assertThat(videoRepository.findAll()).hasSize(1);
		verifyNoInteractions(multipartStorage);
	}

	@Test
	void rejectsChunkSizeBelowMinimumAndNonPositiveEstimate() throws Exception {
		mockMvc.perform(post("/videos")
						.header("Authorization", "Bearer " + token)
						.contentType(MediaType.APPLICATION_JSON)
						.content("""
								{"title":"Too small chunk","estimated_size_bytes":10485760,"chunk_size_bytes":1048576}
								"""))
				.andExpect(status().isBadRequest())
				.andExpect(jsonPath("$.error.code").value("VALIDATION_ERROR"));

		mockMvc.perform(post("/videos")
						.header("Authorization", "Bearer " + token)
						.contentType(MediaType.APPLICATION_JSON)
						.content("""
								{"title":"Bad estimate","estimated_size_bytes":0,"chunk_size_bytes":5242880}
								"""))
				.andExpect(status().isBadRequest())
				.andExpect(jsonPath("$.error.code").value("VALIDATION_ERROR"));

		verifyNoInteractions(multipartStorage);
	}

	@Test
	void requiresAuthentication() throws Exception {
		mockMvc.perform(post("/videos")
						.contentType(MediaType.APPLICATION_JSON)
						.content("""
								{"title":"No token","estimated_size_bytes":10485760,"chunk_size_bytes":5242880}
								"""))
				.andExpect(status().isUnauthorized());

		verifyNoInteractions(multipartStorage);
	}

	private User createUser() {
		User newUser = new User();
		newUser.setEmail("video-" + UUID.randomUUID() + "@example.com");
		newUser.setPasswordHash("test-only-hash");
		newUser.setDisplayName("video-user");
		return userRepository.saveAndFlush(newUser);
	}

	private void seedReadyVideo(long fileSizeBytes) {
		Video video = new Video();
		video.setUserId(user.getId());
		video.setTitle("Existing ready video");
		video.setStoragePath("videos/" + UUID.randomUUID() + "/source.mp4");
		video.setFileSizeBytes(fileSizeBytes);
		video.setFormat("mp4");
		video.setStatus(VideoStatus.READY);
		videoRepository.saveAndFlush(video);
	}
}
