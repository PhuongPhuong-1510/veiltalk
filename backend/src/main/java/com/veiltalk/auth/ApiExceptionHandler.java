package com.veiltalk.auth;

import java.util.LinkedHashMap;
import java.util.Map;

import org.springframework.http.HttpStatus;
import org.springframework.http.HttpHeaders;
import org.springframework.http.ResponseEntity;
import org.springframework.http.converter.HttpMessageNotReadableException;
import org.springframework.web.HttpMediaTypeNotSupportedException;
import org.springframework.web.HttpRequestMethodNotSupportedException;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;
import org.springframework.web.method.annotation.MethodArgumentTypeMismatchException;
import org.springframework.web.multipart.MultipartException;

import com.veiltalk.video.StorageQuotaExceededException;
import com.veiltalk.video.VideoOperationConflictException;
import com.veiltalk.video.VideoStorageException;
import com.veiltalk.avatar.AvatarConflictException;
import com.veiltalk.avatar.AvatarStorageException;

@RestControllerAdvice
public class ApiExceptionHandler {

	@ExceptionHandler(MethodArgumentNotValidException.class)
	ResponseEntity<Map<String, Object>> handleValidation(MethodArgumentNotValidException exception) {
		var fieldError = exception.getBindingResult().getFieldErrors().stream().findFirst();
		Map<String, Object> details = new LinkedHashMap<>();
		fieldError.ifPresent(error -> {
			details.put("field", error.getField());
			details.put("constraint", error.getCode());
		});
		String message = fieldError
				.map(error -> error.getDefaultMessage() == null ? "Invalid request" : error.getDefaultMessage())
				.orElse("Invalid request");
		return error(HttpStatus.BAD_REQUEST, "VALIDATION_ERROR", message, details);
	}

	@ExceptionHandler(HttpMessageNotReadableException.class)
	ResponseEntity<Map<String, Object>> handleUnreadableRequest(HttpMessageNotReadableException exception) {
		return error(HttpStatus.BAD_REQUEST, "VALIDATION_ERROR", "Invalid request body", Map.of());
	}

	@ExceptionHandler(MethodArgumentTypeMismatchException.class)
	ResponseEntity<Map<String, Object>> handleTypeMismatch(MethodArgumentTypeMismatchException exception) {
		return error(HttpStatus.BAD_REQUEST, "VALIDATION_ERROR", "Invalid request parameter", Map.of());
	}

	@ExceptionHandler(HttpRequestMethodNotSupportedException.class)
	ResponseEntity<Map<String, Object>> handleUnsupportedMethod(HttpRequestMethodNotSupportedException exception) {
		return error(HttpStatus.METHOD_NOT_ALLOWED, "METHOD_NOT_ALLOWED", "Method not allowed", Map.of());
	}

	@ExceptionHandler(HttpMediaTypeNotSupportedException.class)
	ResponseEntity<Map<String, Object>> handleUnsupportedMediaType(HttpMediaTypeNotSupportedException exception) {
		return error(HttpStatus.UNSUPPORTED_MEDIA_TYPE, "UNSUPPORTED_MEDIA_TYPE", "Unsupported media type", Map.of());
	}

	@ExceptionHandler(MultipartException.class)
	ResponseEntity<Map<String, Object>> handleMalformedMultipart(MultipartException exception) {
		return error(HttpStatus.BAD_REQUEST, "VALIDATION_ERROR", "Invalid multipart request", Map.of());
	}

	@ExceptionHandler(ConflictException.class)
	ResponseEntity<Map<String, Object>> handleConflict(ConflictException exception) {
		return error(HttpStatus.CONFLICT, "CONFLICT", exception.getMessage(), Map.of());
	}

	@ExceptionHandler(AvatarConflictException.class)
	ResponseEntity<Map<String, Object>> handleAvatarConflict(AvatarConflictException exception) {
		return error(HttpStatus.CONFLICT, exception.code(), exception.getMessage(), Map.of());
	}

	@ExceptionHandler(AvatarStorageException.class)
	ResponseEntity<Map<String, Object>> handleAvatarStorage(AvatarStorageException exception) {
		return error(HttpStatus.SERVICE_UNAVAILABLE, "AVATAR_STORAGE_UNAVAILABLE",
				"Avatar storage is temporarily unavailable", Map.of());
	}

	@ExceptionHandler(UsernameTakenException.class)
	ResponseEntity<Map<String, Object>> handleUsernameTaken(UsernameTakenException exception) {
		return error(HttpStatus.CONFLICT, "USERNAME_TAKEN", exception.getMessage(), Map.of());
	}

	@ExceptionHandler(com.veiltalk.user.UsernameRequiredException.class)
	ResponseEntity<Map<String, Object>> handleUsernameRequired(
			com.veiltalk.user.UsernameRequiredException exception) {
		return error(HttpStatus.CONFLICT, "USERNAME_REQUIRED", exception.getMessage(), Map.of());
	}

	@ExceptionHandler(VideoOperationConflictException.class)
	ResponseEntity<Map<String, Object>> handleVideoConflict(VideoOperationConflictException exception) {
		return error(HttpStatus.CONFLICT, "CONFLICT", exception.getMessage(), Map.of());
	}

	@ExceptionHandler(UnauthorizedException.class)
	ResponseEntity<Map<String, Object>> handleUnauthorized(UnauthorizedException exception) {
		return error(HttpStatus.UNAUTHORIZED, "UNAUTHORIZED", exception.getMessage(), Map.of());
	}

	@ExceptionHandler(TooManyRequestsException.class)
	ResponseEntity<Map<String, Object>> handleAuthRateLimit(TooManyRequestsException exception) {
		long seconds = Math.max(1, (exception.retryAfter().toMillis() + 999) / 1000);
		return ResponseEntity.status(HttpStatus.TOO_MANY_REQUESTS)
				.header(HttpHeaders.RETRY_AFTER, String.valueOf(seconds))
				.body(Map.of("error", Map.of("code", "RATE_LIMITED", "message", "Too many requests", "details", Map.of())));
	}

	@ExceptionHandler(NotFoundException.class)
	ResponseEntity<Map<String, Object>> handleNotFound(NotFoundException exception) {
		return error(HttpStatus.NOT_FOUND, "NOT_FOUND", exception.getMessage(), Map.of());
	}

	@ExceptionHandler(ForbiddenException.class)
	ResponseEntity<Map<String, Object>> handleForbidden(ForbiddenException exception) {
		return error(HttpStatus.FORBIDDEN, "FORBIDDEN", exception.getMessage(), Map.of());
	}

	@ExceptionHandler(StorageQuotaExceededException.class)
	ResponseEntity<Map<String, Object>> handleStorageQuota(StorageQuotaExceededException exception) {
		return error(HttpStatus.INSUFFICIENT_STORAGE, "STORAGE_QUOTA_EXCEEDED", exception.getMessage(), Map.of());
	}

	@ExceptionHandler(VideoStorageException.class)
	ResponseEntity<Map<String, Object>> handleVideoStorage(VideoStorageException exception) {
		return error(HttpStatus.INTERNAL_SERVER_ERROR, "INTERNAL_ERROR",
				"Không thể xử lý lưu trữ video lúc này.", Map.of());
	}

	@ExceptionHandler(ValidationException.class)
	ResponseEntity<Map<String, Object>> handleValidation(ValidationException exception) {
		return error(HttpStatus.BAD_REQUEST, "VALIDATION_ERROR", exception.getMessage(), Map.of());
	}

	private ResponseEntity<Map<String, Object>> error(
			HttpStatus status,
			String code,
			String message,
			Map<String, Object> details) {
		Map<String, Object> body = Map.of(
				"error",
				Map.of(
						"code", code,
						"message", message,
						"details", details));
		return ResponseEntity.status(status).body(body);
	}
}
