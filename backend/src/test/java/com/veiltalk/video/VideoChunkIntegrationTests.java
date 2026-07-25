package com.veiltalk.video;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.BDDMockito.given;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.util.HashSet;
import java.util.Set;
import java.util.UUID;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.http.MediaType;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.transaction.annotation.Transactional;

import com.veiltalk.auth.JwtService;
import com.veiltalk.auth.User;
import com.veiltalk.auth.UserRepository;

/**
 * TC-30 và các nhánh lỗi của POST /videos/{id}/chunks.
 *
 * <p>Chạy trên Redis THẬT (giống AuthRefreshLogoutIntegrationTests) để kiểm chứng Lua reserveNextPart
 * chạy nguyên tử và idempotent — không chỉ mock. @Transactional rollback DB nhưng KHÔNG rollback Redis,
 * nên dọn key phiên thủ công ở teardown.
 */
@SpringBootTest
@AutoConfigureMockMvc
@Transactional
class VideoChunkIntegrationTests {

	private static final String UPLOAD_ID = "minio-multipart-upload-id";
	private static final String CHUNK_URL =
			"https://minio.internal/veiltalk/videos/abc/source.mp4?uploadId=" + UPLOAD_ID
					+ "&partNumber=2&X-Amz-Signature=stub";
	private static final long SMALL_CHUNK_SIZE = 5_242_880L;

	@Autowired
	private MockMvc mockMvc;

	@Autowired
	private UserRepository userRepository;

	@Autowired
	private VideoRepository videoRepository;

	@Autowired
	private JwtService jwtService;

	@Autowired
	private VideoUploadSessionStore sessionStore;

	@Autowired
	private StringRedisTemplate redisTemplate;

	@MockitoBean
	private VideoMultipartStorage multipartStorage;

	private User user;
	private String token;
	private final Set<UUID> sessionVideoIds = new HashSet<>();

	@BeforeEach
	void setUp() {
		user = createUser();
		token = jwtService.generateAccessToken(user.getId(), user.getRole());
		given(multipartStorage.presignPartUrl(anyString(), anyString(), anyInt())).willReturn(CHUNK_URL);
	}

	@AfterEach
	void tearDown() {
		// Redis không nằm trong transaction test — dọn key phiên đã tạo.
		sessionVideoIds.forEach(id -> redisTemplate.delete("video:upload:" + id));
	}

	@Test
	void tc30ReturnsUrlForNextChunkAndStoresEtag() throws Exception {
		Video video = seedRecordingVideo(user.getId());
		sessionStore.createSession(video.getId(), UPLOAD_ID, user.getId(), SMALL_CHUNK_SIZE);

		mockMvc.perform(postChunk(video.getId(), UPLOAD_ID, 2, "etag-1"))
				.andExpect(status().isOk())
				.andExpect(jsonPath("$.chunk_url").value(CHUNK_URL))
				.andExpect(jsonPath("$.part_number").value(2))
				.andExpect(jsonPath("$.expires_in").value(3600));

		// ETag của part 1 (part_number - 1) đã lưu; con trỏ tiến sang part 3.
		assertThat(hashField(video.getId(), "etag:1")).isEqualTo("etag-1");
		assertThat(hashField(video.getId(), "nextPartNumber")).isEqualTo("3");
	}

	@Test
	void retryWithSameEtagReissuesUrlWithoutDuplicating() throws Exception {
		Video video = seedRecordingVideo(user.getId());
		sessionStore.createSession(video.getId(), UPLOAD_ID, user.getId(), SMALL_CHUNK_SIZE);

		mockMvc.perform(postChunk(video.getId(), UPLOAD_ID, 2, "etag-1")).andExpect(status().isOk());
		// Retry đúng part cũ + đúng etag → cấp lại URL, KHÔNG nhân đôi ETag, con trỏ giữ nguyên.
		mockMvc.perform(postChunk(video.getId(), UPLOAD_ID, 2, "etag-1")).andExpect(status().isOk());

		assertThat(hashField(video.getId(), "etag:1")).isEqualTo("etag-1");
		assertThat(hashField(video.getId(), "nextPartNumber")).isEqualTo("3");
		verify(multipartStorage, times(2)).presignPartUrl(anyString(), anyString(), anyInt());
	}

	@Test
	void retryWithDifferentEtagIsRejected() throws Exception {
		Video video = seedRecordingVideo(user.getId());
		sessionStore.createSession(video.getId(), UPLOAD_ID, user.getId(), SMALL_CHUNK_SIZE);
		mockMvc.perform(postChunk(video.getId(), UPLOAD_ID, 2, "etag-1")).andExpect(status().isOk());

		mockMvc.perform(postChunk(video.getId(), UPLOAD_ID, 2, "etag-DIFFERENT"))
				.andExpect(status().isBadRequest())
				.andExpect(jsonPath("$.error.code").value("VALIDATION_ERROR"));
	}

	@Test
	void outOfOrderPartNumberIsRejected() throws Exception {
		Video video = seedRecordingVideo(user.getId());
		sessionStore.createSession(video.getId(), UPLOAD_ID, user.getId(), SMALL_CHUNK_SIZE);

		// nextPartNumber = 2, nhưng client nhảy sang part 3.
		mockMvc.perform(postChunk(video.getId(), UPLOAD_ID, 3, "etag-2"))
				.andExpect(status().isBadRequest())
				.andExpect(jsonPath("$.error.code").value("VALIDATION_ERROR"));
	}

	@Test
	void mismatchedUploadIdIsRejected() throws Exception {
		Video video = seedRecordingVideo(user.getId());
		sessionStore.createSession(video.getId(), UPLOAD_ID, user.getId(), SMALL_CHUNK_SIZE);

		mockMvc.perform(postChunk(video.getId(), "WRONG-UPLOAD-ID", 2, "etag-1"))
				.andExpect(status().isBadRequest())
				.andExpect(jsonPath("$.error.code").value("VALIDATION_ERROR"));
	}

	@Test
	void exceedingQuotaReturns507() throws Exception {
		// User đã có ~1.99GB video 'ready'; part 50MB đẩy ước lượng vượt 2GB.
		seedReadyVideo(2_136_746_229L);
		Video video = seedRecordingVideo(user.getId());
		sessionStore.createSession(video.getId(), UPLOAD_ID, user.getId(), 52_428_800L);

		mockMvc.perform(postChunk(video.getId(), UPLOAD_ID, 2, "etag-1"))
				.andExpect(status().isInsufficientStorage())
				.andExpect(jsonPath("$.error.code").value("STORAGE_QUOTA_EXCEEDED"));
	}

	@Test
	void videoOfAnotherUserReturns403() throws Exception {
		User other = createUser();
		Video video = seedRecordingVideo(other.getId());
		sessionStore.createSession(video.getId(), UPLOAD_ID, other.getId(), SMALL_CHUNK_SIZE);

		mockMvc.perform(postChunk(video.getId(), UPLOAD_ID, 2, "etag-1"))
				.andExpect(status().isForbidden())
				.andExpect(jsonPath("$.error.code").value("FORBIDDEN"));
	}

	@Test
	void missingVideoReturns404() throws Exception {
		mockMvc.perform(postChunk(UUID.randomUUID(), UPLOAD_ID, 2, "etag-1"))
				.andExpect(status().isNotFound())
				.andExpect(jsonPath("$.error.code").value("NOT_FOUND"));
	}

	@Test
	void expiredSessionReturns404() throws Exception {
		// Video 'recording' còn trong DB nhưng phiên Redis đã mất (hết hạn/đã finalize).
		Video video = seedRecordingVideo(user.getId());

		mockMvc.perform(postChunk(video.getId(), UPLOAD_ID, 2, "etag-1"))
				.andExpect(status().isNotFound())
				.andExpect(jsonPath("$.error.code").value("NOT_FOUND"));
	}

	@Test
	void partNumberBelowTwoFailsValidation() throws Exception {
		Video video = seedRecordingVideo(user.getId());
		sessionStore.createSession(video.getId(), UPLOAD_ID, user.getId(), SMALL_CHUNK_SIZE);

		mockMvc.perform(postChunk(video.getId(), UPLOAD_ID, 1, "etag-1"))
				.andExpect(status().isBadRequest())
				.andExpect(jsonPath("$.error.code").value("VALIDATION_ERROR"));
		verifyNoInteractions(multipartStorage);
	}

	@Test
	void requiresAuthentication() throws Exception {
		mockMvc.perform(post("/videos/" + UUID.randomUUID() + "/chunks")
						.contentType(MediaType.APPLICATION_JSON)
						.content(chunkBody(UPLOAD_ID, 2, "etag-1")))
				.andExpect(status().isUnauthorized());
		verifyNoInteractions(multipartStorage);
	}

	private org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder postChunk(
			UUID videoId, String uploadId, int partNumber, String etagPrevious) {
		return post("/videos/" + videoId + "/chunks")
				.header("Authorization", "Bearer " + token)
				.contentType(MediaType.APPLICATION_JSON)
				.content(chunkBody(uploadId, partNumber, etagPrevious));
	}

	private String chunkBody(String uploadId, int partNumber, String etagPrevious) {
		return "{\"upload_id\":\"" + uploadId + "\",\"part_number\":" + partNumber
				+ ",\"etag_previous\":\"" + etagPrevious + "\"}";
	}

	private String hashField(UUID videoId, String field) {
		Object value = redisTemplate.opsForHash().get("video:upload:" + videoId, field);
		return value == null ? null : value.toString();
	}

	private User createUser() {
		User newUser = new User();
		newUser.setEmail("video-" + UUID.randomUUID() + "@example.com");
		newUser.setPasswordHash("test-only-hash");
		newUser.setDisplayName("video-user");
		return userRepository.saveAndFlush(newUser);
	}

	private Video seedRecordingVideo(UUID ownerId) {
		Video video = new Video();
		video.setUserId(ownerId);
		video.setTitle("Recording video");
		video.setStoragePath("videos/" + UUID.randomUUID() + "/source.mp4");
		video.setFileSizeBytes(10_485_760L);
		video.setFormat("mp4");
		video.setStatus(VideoStatus.RECORDING);
		Video saved = videoRepository.saveAndFlush(video);
		sessionVideoIds.add(saved.getId());
		return saved;
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
