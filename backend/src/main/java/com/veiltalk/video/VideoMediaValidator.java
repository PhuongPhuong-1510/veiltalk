package com.veiltalk.video;

import java.io.InputStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Duration;
import java.util.Set;
import java.util.concurrent.TimeUnit;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;

import io.minio.GetObjectArgs;
import io.minio.MinioAsyncClient;
import jakarta.annotation.PostConstruct;

/** Checks completed objects before any path can expose them as READY. */
@Component
public class VideoMediaValidator {

	private final MinioAsyncClient minio;
	private final MinioProperties minioProperties;
	private final ObjectMapper mapper;
	private final String executable;
	private final Duration timeout;

	public VideoMediaValidator(MinioAsyncClient minio, MinioProperties minioProperties,
			ObjectMapper mapper,
			@Value("${video.ffprobe-path:ffprobe}") String executable,
			@Value("${video.ffprobe-timeout-seconds:30}") long timeoutSeconds) {
		this.minio = minio;
		this.minioProperties = minioProperties;
		this.mapper = mapper;
		this.executable = executable;
		if (timeoutSeconds <= 0) throw new IllegalArgumentException("ffprobe timeout must be positive");
		this.timeout = Duration.ofSeconds(timeoutSeconds);
	}

	@PostConstruct
	void requireProbe() {
		try {
			Process process = new ProcessBuilder(executable, "-version")
					.redirectOutput(ProcessBuilder.Redirect.DISCARD)
					.redirectError(ProcessBuilder.Redirect.DISCARD).start();
			if (!process.waitFor(5, TimeUnit.SECONDS) || process.exitValue() != 0) {
				process.destroyForcibly();
				throw new IllegalStateException("ffprobe is unavailable");
			}
		} catch (InterruptedException exception) {
			Thread.currentThread().interrupt();
			throw new IllegalStateException("ffprobe startup check interrupted", exception);
		} catch (java.io.IOException exception) {
			throw new IllegalStateException("ffprobe is unavailable", exception);
		}
	}

	/** Returns false for invalid media; infrastructure failures throw and leave PROCESSING for retry. */
	public boolean isPlayable(String objectKey, String declaredFormat, long expectedBytes) {
		Path file = null;
		try {
			file = Files.createTempFile("veiltalk-media-", ".bin");
			try (InputStream source = minio.getObject(GetObjectArgs.builder()
					.bucket(minioProperties.bucket()).object(objectKey).build()).get()) {
				Files.copy(source, file, java.nio.file.StandardCopyOption.REPLACE_EXISTING);
			}
			if (Files.size(file) != expectedBytes) return false;
			Process process = new ProcessBuilder(executable, "-v", "error", "-read_intervals",
					"%+#1", "-count_frames", "-show_entries",
					"stream=codec_type,codec_name,nb_read_frames:format=format_name,duration", "-of", "json",
					file.toString()).redirectErrorStream(true).start();
			if (!process.waitFor(timeout.toMillis(), TimeUnit.MILLISECONDS)) {
				process.destroyForcibly();
				throw new VideoStorageException("Media probe timed out", null);
			}
			byte[] output = process.getInputStream().readNBytes(65536);
			if (process.exitValue() != 0) return false;
			JsonNode probe = mapper.readTree(output);
			return accepts(probe, declaredFormat);
		} catch (InterruptedException exception) {
			Thread.currentThread().interrupt();
			throw new VideoStorageException("Media probe interrupted", exception);
		} catch (Exception exception) {
			throw new VideoStorageException("Media probe unavailable", exception);
		} finally {
			if (file != null) {
				try { Files.deleteIfExists(file); }
				catch (java.io.IOException ignored) { /* OS cleanup remains necessary. */ }
			}
		}
	}

	private boolean accepts(JsonNode probe, String declaredFormat) {
		boolean mp4 = "mp4".equalsIgnoreCase(declaredFormat);
		boolean webm = "webm".equalsIgnoreCase(declaredFormat);
		if (!mp4 && !webm) return false;
		String container = probe.path("format").path("format_name").asText("");
		if (mp4 && !Set.of(container.split(",")).contains("mp4")) return false;
		if (webm && !Set.of(container.split(",")).contains("webm")) return false;
		double duration = probe.path("format").path("duration").asDouble(0);
		if (!Double.isFinite(duration) || duration <= 0) return false;
		boolean videoFound = false;
		for (JsonNode stream : probe.path("streams")) {
			String type = stream.path("codec_type").asText();
			String codec = stream.path("codec_name").asText();
			if ("video".equals(type)) {
				if (mp4 ? !"h264".equals(codec) : !Set.of("vp8", "vp9", "av1").contains(codec)) return false;
				if (stream.path("nb_read_frames").asInt(0) < 1) return false;
				videoFound = true;
			} else if ("audio".equals(type)) {
				if (mp4 ? !"aac".equals(codec) : !Set.of("opus", "vorbis").contains(codec)) return false;
			}
		}
		return videoFound;
	}
}
