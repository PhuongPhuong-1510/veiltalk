package com.veiltalk.auth;

import java.util.LinkedHashMap;
import java.util.Map;

import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.http.converter.HttpMessageNotReadableException;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;

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

	@ExceptionHandler(ConflictException.class)
	ResponseEntity<Map<String, Object>> handleConflict(ConflictException exception) {
		return error(HttpStatus.CONFLICT, "CONFLICT", exception.getMessage(), Map.of());
	}

	@ExceptionHandler(UnauthorizedException.class)
	ResponseEntity<Map<String, Object>> handleUnauthorized(UnauthorizedException exception) {
		return error(HttpStatus.UNAUTHORIZED, "UNAUTHORIZED", exception.getMessage(), Map.of());
	}

	@ExceptionHandler(NotFoundException.class)
	ResponseEntity<Map<String, Object>> handleNotFound(NotFoundException exception) {
		return error(HttpStatus.NOT_FOUND, "NOT_FOUND", exception.getMessage(), Map.of());
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
