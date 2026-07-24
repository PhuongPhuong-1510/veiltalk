package com.veiltalk.auth;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.time.Clock;
import java.time.Instant;
import java.util.Base64;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.UUID;

import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;

@Service
public class JwtService {

	private static final String HMAC_ALGORITHM = "HmacSHA256";
	private static final String ACCESS_TOKEN_TYPE = "access";
	private static final String REFRESH_TOKEN_TYPE = "refresh";
	private static final int MINIMUM_SECRET_BYTES = 32;
	private static final Base64.Encoder BASE64_URL_ENCODER = Base64.getUrlEncoder().withoutPadding();
	private static final Base64.Decoder BASE64_URL_DECODER = Base64.getUrlDecoder();
	private static final TypeReference<Map<String, Object>> MAP_TYPE = new TypeReference<>() {
	};

	private final byte[] secret;
	private final long accessExpirySeconds;
	private final long refreshExpirySeconds;
	private final ObjectMapper objectMapper;
	private final Clock clock;

	public JwtService(
			@Value("${jwt.secret}") String secret,
			@Value("${jwt.access-expiry}") long accessExpirySeconds,
			@Value("${jwt.refresh-expiry}") long refreshExpirySeconds,
			ObjectMapper objectMapper) {
		this(secret, accessExpirySeconds, refreshExpirySeconds, objectMapper, Clock.systemUTC());
	}

	JwtService(
			String secret,
			long accessExpirySeconds,
			long refreshExpirySeconds,
			ObjectMapper objectMapper,
			Clock clock) {
		if (secret == null || secret.isBlank()) {
			throw new IllegalArgumentException("JWT secret must not be blank");
		}
		if (secret.getBytes(StandardCharsets.UTF_8).length < MINIMUM_SECRET_BYTES) {
			throw new IllegalArgumentException("JWT secret must contain at least 32 bytes");
		}
		if (accessExpirySeconds <= 0 || refreshExpirySeconds <= 0) {
			throw new IllegalArgumentException("JWT expiry values must be positive");
		}
		this.secret = secret.getBytes(StandardCharsets.UTF_8);
		this.accessExpirySeconds = accessExpirySeconds;
		this.refreshExpirySeconds = refreshExpirySeconds;
		this.objectMapper = objectMapper;
		this.clock = clock;
	}

	public String generateAccessToken(UUID userId, UserRole role) {
		if (userId == null || role == null) {
			throw new IllegalArgumentException("User ID and role are required");
		}

		Instant issuedAt = clock.instant();
		Map<String, Object> claims = baseClaims(ACCESS_TOKEN_TYPE, issuedAt, accessExpirySeconds);
		claims.put("sub", userId.toString());
		claims.put("role", role.getDatabaseValue());
		return createToken(claims);
	}

	public String generateRefreshToken() {
		Instant issuedAt = clock.instant();
		return createToken(baseClaims(REFRESH_TOKEN_TYPE, issuedAt, refreshExpirySeconds));
	}

	public boolean validateToken(String token) {
		try {
			extractClaims(token);
			return true;
		}
		catch (IllegalArgumentException exception) {
			return false;
		}
	}

	public boolean validateAccessToken(String token) {
		return validateTokenType(token, ACCESS_TOKEN_TYPE);
	}

	public boolean validateRefreshToken(String token) {
		return validateTokenType(token, REFRESH_TOKEN_TYPE);
	}

	public JwtClaims extractClaims(String token) {
		String[] parts = splitToken(token);
		Map<String, Object> header = decodeJson(parts[0]);
		if (!"HS256".equals(header.get("alg")) || !"JWT".equals(header.get("typ"))) {
			throw new IllegalArgumentException("Unsupported JWT header");
		}

		byte[] actualSignature = decodeBase64(parts[2]);
		byte[] expectedSignature = sign(parts[0] + "." + parts[1]);
		if (!MessageDigest.isEqual(expectedSignature, actualSignature)) {
			throw new IllegalArgumentException("Invalid JWT signature");
		}

		Map<String, Object> payload = decodeJson(parts[1]);
		JwtClaims claims = toClaims(payload);
		if (!claims.expiresAt().isAfter(clock.instant())) {
			throw new IllegalArgumentException("JWT has expired");
		}
		if (claims.issuedAt().isAfter(clock.instant())) {
			throw new IllegalArgumentException("JWT issued-at time is in the future");
		}
		return claims;
	}

	private boolean validateTokenType(String token, String expectedType) {
		try {
			return expectedType.equals(extractClaims(token).type());
		}
		catch (IllegalArgumentException exception) {
			return false;
		}
	}

	private Map<String, Object> baseClaims(String type, Instant issuedAt, long expirySeconds) {
		Map<String, Object> claims = new LinkedHashMap<>();
		claims.put("type", type);
		claims.put("jti", UUID.randomUUID().toString());
		claims.put("iat", issuedAt.getEpochSecond());
		claims.put("exp", issuedAt.plusSeconds(expirySeconds).getEpochSecond());
		return claims;
	}

	private String createToken(Map<String, Object> claims) {
		Map<String, Object> header = Map.of("alg", "HS256", "typ", "JWT");
		String encodedHeader = encodeJson(header);
		String encodedPayload = encodeJson(claims);
		String signingInput = encodedHeader + "." + encodedPayload;
		String encodedSignature = BASE64_URL_ENCODER.encodeToString(sign(signingInput));
		return signingInput + "." + encodedSignature;
	}

	private JwtClaims toClaims(Map<String, Object> payload) {
		String type = requiredString(payload, "type");
		if (!ACCESS_TOKEN_TYPE.equals(type) && !REFRESH_TOKEN_TYPE.equals(type)) {
			throw new IllegalArgumentException("Unsupported JWT type");
		}

		UUID subject = null;
		UserRole role = null;
		if (ACCESS_TOKEN_TYPE.equals(type)) {
			subject = parseUuid(requiredString(payload, "sub"), "sub");
			try {
				role = UserRole.fromDatabaseValue(requiredString(payload, "role"));
			}
			catch (IllegalArgumentException exception) {
				throw new IllegalArgumentException("Invalid JWT role", exception);
			}
		}
		else if (payload.containsKey("sub") || payload.containsKey("role")) {
			throw new IllegalArgumentException("Refresh JWT contains access claims");
		}

		UUID jwtId = parseUuid(requiredString(payload, "jti"), "jti");
		Instant issuedAt = Instant.ofEpochSecond(requiredLong(payload, "iat"));
		Instant expiresAt = Instant.ofEpochSecond(requiredLong(payload, "exp"));
		if (!expiresAt.isAfter(issuedAt)) {
			throw new IllegalArgumentException("JWT expiry must be after issued-at time");
		}
		return new JwtClaims(subject, role, type, jwtId, issuedAt, expiresAt);
	}

	private String[] splitToken(String token) {
		if (token == null || token.isBlank()) {
			throw new IllegalArgumentException("JWT must not be blank");
		}
		String[] parts = token.split("\\.", -1);
		if (parts.length != 3 || parts[0].isEmpty() || parts[1].isEmpty() || parts[2].isEmpty()) {
			throw new IllegalArgumentException("Malformed JWT");
		}
		return parts;
	}

	private String encodeJson(Map<String, Object> value) {
		try {
			return BASE64_URL_ENCODER.encodeToString(objectMapper.writeValueAsBytes(value));
		}
		catch (JsonProcessingException exception) {
			throw new IllegalStateException("Could not encode JWT", exception);
		}
	}

	private Map<String, Object> decodeJson(String encodedValue) {
		try {
			return objectMapper.readValue(decodeBase64(encodedValue), MAP_TYPE);
		}
		catch (IOException exception) {
			throw new IllegalArgumentException("Malformed JWT JSON", exception);
		}
	}

	private byte[] decodeBase64(String value) {
		try {
			return BASE64_URL_DECODER.decode(value);
		}
		catch (IllegalArgumentException exception) {
			throw new IllegalArgumentException("Malformed JWT encoding", exception);
		}
	}

	private byte[] sign(String signingInput) {
		try {
			Mac mac = Mac.getInstance(HMAC_ALGORITHM);
			mac.init(new SecretKeySpec(secret, HMAC_ALGORITHM));
			return mac.doFinal(signingInput.getBytes(StandardCharsets.UTF_8));
		}
		catch (Exception exception) {
			throw new IllegalStateException("Could not sign JWT", exception);
		}
	}

	private String requiredString(Map<String, Object> payload, String claimName) {
		Object value = payload.get(claimName);
		if (value instanceof String stringValue && !stringValue.isBlank()) {
			return stringValue;
		}
		throw new IllegalArgumentException("Missing or invalid JWT claim: " + claimName);
	}

	private long requiredLong(Map<String, Object> payload, String claimName) {
		Object value = payload.get(claimName);
		if (value instanceof Number number) {
			return number.longValue();
		}
		throw new IllegalArgumentException("Missing or invalid JWT claim: " + claimName);
	}

	private UUID parseUuid(String value, String claimName) {
		try {
			return UUID.fromString(value);
		}
		catch (IllegalArgumentException exception) {
			throw new IllegalArgumentException("Invalid JWT claim: " + claimName, exception);
		}
	}
}
