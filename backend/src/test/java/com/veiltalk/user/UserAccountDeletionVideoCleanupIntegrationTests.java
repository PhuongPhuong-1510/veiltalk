package com.veiltalk.user;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.BDDMockito.willThrow;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.util.List;
import java.util.UUID;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.http.MediaType;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;

import com.veiltalk.auth.RefreshTokenRepository;
import com.veiltalk.auth.User;
import com.veiltalk.auth.UserRepository;
import com.veiltalk.video.Video;
import com.veiltalk.video.VideoCleanupJob;
import com.veiltalk.video.VideoCleanupJobRepository;
import com.veiltalk.video.VideoMultipartStorage;
import com.veiltalk.video.VideoRepository;
import com.veiltalk.video.VideoStatus;
import com.veiltalk.video.VideoStorageException;
import com.veiltalk.video.VideoUploadSessionStore;

/**
 * P2-T24 — TC-37: DELETE /users/me phải abort mọi video 'recording' của user trên MinIO.
 *
 * <p>{@code VideoAccountCleanupService} ghi thay đổi qua transaction REQUIRES_NEW
 * ({@code VideoCleanupTransactionSupport}), chạy trên connection RIÊNG. Vì vậy class này CHỦ Ý
 * KHÔNG dùng {@code @Transactional} — nếu dữ liệu setUp() nằm trong một transaction test chưa
 * commit, REQUIRES_NEW (transaction khác) sẽ không nhìn thấy nó (vi phạm FK). Dọn dẹp mọi thứ
 * thủ công ở {@code @AfterEach} thay vì dựa vào rollback.
 */
@SpringBootTest
@AutoConfigureMockMvc
class UserAccountDeletionVideoCleanupIntegrationTests {

	private static final String PASSWORD = "Secure123";
	private static final String UPLOAD_ID = "upload-account-delete";

	@Autowired
	private MockMvc mockMvc;
	@Autowired
	private UserRepository userRepository;
	@Autowired
	private RefreshTokenRepository refreshTokenRepository;
	@Autowired
	private VideoRepository videoRepository;
	@Autowired
	private VideoCleanupJobRepository cleanupJobRepository;
	@Autowired
	private VideoUploadSessionStore sessionStore;
	@Autowired
	private StringRedisTemplate redisTemplate;
	@Autowired
	private PasswordEncoder passwordEncoder;

	@MockitoBean
	private VideoMultipartStorage multipartStorage;

	private User user;
	private Video video;

	@BeforeEach
	void setUp() {
		user = new User();
		user.setEmail("t37-" + UUID.randomUUID() + "@example.com");
		user.setPasswordHash(passwordEncoder.encode(PASSWORD));
		user.setDisplayName("TC-37 user");
		user = userRepository.saveAndFlush(user);

		video = new Video();
		video.setUserId(user.getId());
		video.setTitle("Recording khi xóa tài khoản");
		video.setStoragePath("videos/" + UUID.randomUUID() + "/source.mp4");
		video.setFileSizeBytes(10_485_760L);
		video.setFormat("mp4");
		video.setStatus(VideoStatus.RECORDING);
		video.setUploadId(UPLOAD_ID);
		video = videoRepository.saveAndFlush(video);
		sessionStore.createSession(video.getId(), UPLOAD_ID, user.getId(), 5_242_880L);
	}

	@AfterEach
	void tearDown() {
		// Không dùng @Transactional trên class này (REQUIRES_NEW cần thấy dữ liệu đã commit) —
		// dọn dẹp mọi thứ thủ công thay vì dựa vào rollback.
		cleanupJobRepository.findAll().stream()
				.filter(job -> job.getVideoId().equals(video.getId()))
				.forEach(cleanupJobRepository::delete);
		videoRepository.findById(video.getId()).ifPresent(videoRepository::delete);
		refreshTokenRepository.deleteByUserId(user.getId());
		userRepository.findById(user.getId()).ifPresent(userRepository::delete);
		redisTemplate.delete("video:upload:" + video.getId());
		redisTemplate.delete("video:operation-lock:" + video.getId());
		redisTemplate.delete("jwt:user-revoked-after:" + user.getId());
	}

	@Test
	void tc37AbortSucceedsAndSoftDeletesRecordingVideo() throws Exception {
		String token = login();

		mockMvc.perform(delete("/users/me")
						.header("Authorization", "Bearer " + token)
						.contentType(MediaType.APPLICATION_JSON)
						.content("{\"password\":\"" + PASSWORD + "\"}"))
				.andExpect(status().isNoContent());

		assertThat(userRepository.findById(user.getId()).orElseThrow().getDeletedAt()).isNotNull();

		Video updatedVideo = videoRepository.findById(video.getId()).orElseThrow();
		assertThat(updatedVideo.getStatus()).isEqualTo(VideoStatus.FAILED);
		assertThat(updatedVideo.getDeletedAt()).isNotNull();
		assertThat(sessionStore.findSession(video.getId())).isEmpty();
		assertThat(cleanupJobRepository.findAll().stream()
				.anyMatch(job -> job.getVideoId().equals(video.getId()))).isFalse();
	}

	@Test
	void tc37AbortFailureDoesNotRollbackAccountDeletionAndRecordsCleanupJob() throws Exception {
		willThrow(new VideoStorageException("MinIO unavailable", new RuntimeException()))
				.given(multipartStorage).abortMultipartUpload(anyString(), anyString());
		String token = login();

		mockMvc.perform(delete("/users/me")
						.header("Authorization", "Bearer " + token)
						.contentType(MediaType.APPLICATION_JSON)
						.content("{\"password\":\"" + PASSWORD + "\"}"))
				.andExpect(status().isNoContent());

		// Soft delete/revoke token của tài khoản KHÔNG bị rollback dù MinIO abort lỗi.
		assertThat(userRepository.findById(user.getId()).orElseThrow().getDeletedAt()).isNotNull();

		Video updatedVideo = videoRepository.findById(video.getId()).orElseThrow();
		assertThat(updatedVideo.getStatus())
				.as("video giữ 'recording' khi abort lỗi, giống hành vi POST /videos/{id}/abort")
				.isEqualTo(VideoStatus.RECORDING);
		assertThat(updatedVideo.getDeletedAt()).isNull();

		List<VideoCleanupJob> jobs = cleanupJobRepository.findAll().stream()
				.filter(job -> job.getVideoId().equals(video.getId()))
				.toList();
		assertThat(jobs).hasSize(1);
		assertThat(jobs.get(0).getUploadId()).isEqualTo(UPLOAD_ID);
		assertThat(jobs.get(0).getOperation().name()).isEqualTo("ABORT_MULTIPART");
	}

	private String login() throws Exception {
		var result = mockMvc.perform(post("/auth/login")
						.contentType(MediaType.APPLICATION_JSON)
						.content("""
								{ "email": "%s", "password": "%s" }
								""".formatted(user.getEmail(), PASSWORD)))
				.andExpect(status().isOk())
				.andReturn();
		return com.jayway.jsonpath.JsonPath.read(
				result.getResponse().getContentAsString(), "$.tokens.access_token");
	}
}
