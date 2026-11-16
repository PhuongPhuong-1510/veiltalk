package com.veiltalk.video;

import static org.assertj.core.api.Assertions.assertThatCode;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.ArgumentMatchers.isNull;
import static org.mockito.BDDMockito.given;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;

import java.util.concurrent.CompletableFuture;

import org.junit.jupiter.api.Test;
import org.mockito.Mockito;

import io.minio.MinioAsyncClient;
import io.minio.GetPresignedObjectUrlArgs;
import io.minio.errors.ErrorResponseException;
import io.minio.messages.ErrorResponse;
import okhttp3.Protocol;
import okhttp3.Request;
import okhttp3.Response;

/**
 * P2-T24 — idempotency của abortMultipartUpload: MinIO trả NoSuchUpload (phiên đã bị
 * abort/complete trước đó) phải được coi là thành công để {@link VideoCleanupRetryJob} không
 * lặp vô hạn tới FAILED_PERMANENT khi retry một job đã thực ra xong việc.
 */
class MinioMultipartStorageAbortTests {

	private static final String OBJECT_KEY = "videos/abc/source.mp4";
	private static final String UPLOAD_ID = "upload-id";

	@Test
	void presignedUrlsUseThePublicEndpointClient() throws Exception {
		MinioAsyncClient internal = Mockito.mock(MinioAsyncClient.class);
		MinioAsyncClient publicClient = Mockito.mock(MinioAsyncClient.class);
		given(publicClient.getPresignedObjectUrl(any(GetPresignedObjectUrlArgs.class)))
				.willReturn("https://app.example.test/veiltalk/videos/abc/source.mp4");
		MinioProperties properties = new MinioProperties("http://minio:9000", "key", "secret",
				"veiltalk", new MinioProperties.Webhook("s"), "https://app.example.test");
		VideoProperties videoProperties = new VideoProperties(
				2_147_483_648L, 21_600, 3_600, 30_000, 5_000, 600, 300, 60, 10, 60);
		MinioMultipartStorage storage = new MinioMultipartStorage(
				internal, publicClient, properties, videoProperties);

		assertThat(storage.presignPartUrl(OBJECT_KEY, UPLOAD_ID, 1))
				.startsWith("https://app.example.test/");
		verify(publicClient).getPresignedObjectUrl(any(GetPresignedObjectUrlArgs.class));
		verifyNoInteractions(internal);
	}

	// ErrorResponseException.toString() dereference response.request(); cần Response thật
	// (không null) để tránh NPE khi Throwable dựng message mặc định từ cause.
	private static Response fakeHttpResponse() {
		Request request = new Request.Builder().url("http://localhost:9000/veiltalk/" + OBJECT_KEY).build();
		return new Response.Builder()
				.request(request)
				.protocol(Protocol.HTTP_1_1)
				.code(404)
				.message("Not Found")
				.build();
	}

	@Test
	void noSuchUploadIsTreatedAsSuccessNotError() throws Exception {
		MinioAsyncClient minioAsyncClient = Mockito.mock(MinioAsyncClient.class);
		MinioProperties minioProperties = new MinioProperties(
				"http://localhost:9000", "key", "secret", "veiltalk", new MinioProperties.Webhook("s"), null);
		VideoProperties videoProperties = new VideoProperties(
				2_147_483_648L, 21_600, 3_600, 30_000, 5_000, 600, 300, 60, 10, 60);
		MinioMultipartStorage storage =
				new MinioMultipartStorage(minioAsyncClient, minioAsyncClient, minioProperties, videoProperties);

		ErrorResponse noSuchUpload = new ErrorResponse(
				"NoSuchUpload", "The specified upload does not exist.",
				"veiltalk", OBJECT_KEY, "resource", "req-id", "host-id");
		CompletableFuture<io.minio.AbortMultipartUploadResponse> failed =
				new CompletableFuture<>();
		failed.completeExceptionally(
				new ErrorResponseException(noSuchUpload, fakeHttpResponse(), "req-id"));
		given(minioAsyncClient.abortMultipartUploadAsync(
				eq("veiltalk"), isNull(), eq(OBJECT_KEY), eq(UPLOAD_ID), isNull(), isNull()))
				.willReturn(failed);

		assertThatCode(() -> storage.abortMultipartUpload(OBJECT_KEY, UPLOAD_ID))
				.doesNotThrowAnyException();
	}

	@Test
	void otherMinioErrorsStillPropagateForRetry() throws Exception {
		MinioAsyncClient minioAsyncClient = Mockito.mock(MinioAsyncClient.class);
		MinioProperties minioProperties = new MinioProperties(
				"http://localhost:9000", "key", "secret", "veiltalk", new MinioProperties.Webhook("s"), null);
		VideoProperties videoProperties = new VideoProperties(
				2_147_483_648L, 21_600, 3_600, 30_000, 5_000, 600, 300, 60, 10, 60);
		MinioMultipartStorage storage =
				new MinioMultipartStorage(minioAsyncClient, minioAsyncClient, minioProperties, videoProperties);

		ErrorResponse internalError = new ErrorResponse(
				"InternalError", "We encountered an internal error.",
				"veiltalk", OBJECT_KEY, "resource", "req-id", "host-id");
		CompletableFuture<io.minio.AbortMultipartUploadResponse> failed =
				new CompletableFuture<>();
		failed.completeExceptionally(
				new ErrorResponseException(internalError, fakeHttpResponse(), "req-id"));
		given(minioAsyncClient.abortMultipartUploadAsync(
				eq("veiltalk"), isNull(), eq(OBJECT_KEY), eq(UPLOAD_ID), isNull(), isNull()))
				.willReturn(failed);

		assertThatThrownBy(() -> storage.abortMultipartUpload(OBJECT_KEY, UPLOAD_ID))
				.isInstanceOf(VideoStorageException.class);
	}
}
