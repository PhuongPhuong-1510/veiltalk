package com.veiltalk.auth;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.time.Duration;
import java.time.Instant;
import java.util.HexFormat;
import java.util.UUID;

import com.veiltalk.avatar.AvatarProfileRepository;

import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import jakarta.persistence.EntityManager;

@Service
public class AuthService {

	private static final long ACCESS_TOKEN_EXPIRY_SECONDS = 900;
	private static final String EMAIL_CONFLICT_MESSAGE = "Email is already registered";
	private static final String INVALID_CREDENTIALS_MESSAGE = "Invalid email or password";
	private static final String INVALID_REFRESH_TOKEN_MESSAGE = "Invalid refresh token";

	private final UserRepository userRepository;
	private final RefreshTokenRepository refreshTokenRepository;
	private final AvatarProfileRepository avatarProfileRepository;
	private final JwtService jwtService;
	private final JwtBlacklistService jwtBlacklistService;
	private final PasswordEncoder passwordEncoder;
	private final EntityManager entityManager;

	public AuthService(
			UserRepository userRepository,
			RefreshTokenRepository refreshTokenRepository,
			AvatarProfileRepository avatarProfileRepository,
			JwtService jwtService,
			JwtBlacklistService jwtBlacklistService,
			PasswordEncoder passwordEncoder,
			EntityManager entityManager) {
		this.userRepository = userRepository;
		this.refreshTokenRepository = refreshTokenRepository;
		this.avatarProfileRepository = avatarProfileRepository;
		this.jwtService = jwtService;
		this.jwtBlacklistService = jwtBlacklistService;
		this.passwordEncoder = passwordEncoder;
		this.entityManager = entityManager;
	}

	@Transactional
	public RegisterResponse register(RegisterRequest request) {
		if (userRepository.findByEmailAndDeletedAtIsNull(request.email()).isPresent()) {
			throw new ConflictException(EMAIL_CONFLICT_MESSAGE);
		}

		User user = new User();
		user.setEmail(request.email());
		user.setPasswordHash(passwordEncoder.encode(request.password()));
		user.setDisplayName(request.displayName());

		try {
			userRepository.saveAndFlush(user);
		}
		catch (DataIntegrityViolationException exception) {
			throw new ConflictException(EMAIL_CONFLICT_MESSAGE);
		}
		entityManager.refresh(user);

		String accessToken = jwtService.generateAccessToken(user.getId(), user.getRole());
		String refreshToken = issueRefreshToken(user.getId());
		return new RegisterResponse(
				new RegisterResponse.UserResponse(
						user.getId(),
						user.getEmail(),
						user.getDisplayName(),
						user.getRole().getDatabaseValue(),
						user.getCreatedAt()),
				new RegisterResponse.TokenResponse(
						accessToken,
						refreshToken,
						ACCESS_TOKEN_EXPIRY_SECONDS));
	}

	@Transactional
	public LoginResponse login(LoginRequest request) {
		User user = userRepository.findByEmailAndDeletedAtIsNull(request.email())
				.filter(foundUser -> passwordEncoder.matches(request.password(), foundUser.getPasswordHash()))
				.orElseThrow(() -> new UnauthorizedException(INVALID_CREDENTIALS_MESSAGE));

		String accessToken = jwtService.generateAccessToken(user.getId(), user.getRole());
		String refreshToken = issueRefreshToken(user.getId());

		return new LoginResponse(
				new LoginResponse.UserResponse(
						user.getId(),
						user.getEmail(),
						user.getDisplayName(),
						user.getRole().getDatabaseValue(),
						avatarProfileRepository.existsByUserId(user.getId())),
				new LoginResponse.TokenResponse(
						accessToken,
						refreshToken,
						ACCESS_TOKEN_EXPIRY_SECONDS));
	}

	@Transactional(readOnly = true)
	public RefreshResponse refresh(RefreshTokenRequest request) {
		RefreshToken storedToken = requireActiveRefreshToken(request.refreshToken());
		User user = userRepository.findByIdAndDeletedAtIsNull(storedToken.getUserId())
				.orElseThrow(() -> new UnauthorizedException(INVALID_REFRESH_TOKEN_MESSAGE));
		String accessToken = jwtService.generateAccessToken(user.getId(), user.getRole());
		return new RefreshResponse(accessToken, ACCESS_TOKEN_EXPIRY_SECONDS);
	}

	@Transactional
	public void logout(UUID authenticatedUserId, String accessToken, RefreshTokenRequest request) {
		RefreshToken storedToken = requireActiveRefreshToken(request.refreshToken());
		if (!storedToken.getUserId().equals(authenticatedUserId)) {
			throw new UnauthorizedException(INVALID_REFRESH_TOKEN_MESSAGE);
		}

		JwtClaims accessClaims;
		try {
			accessClaims = jwtService.extractClaims(accessToken);
		}
		catch (IllegalArgumentException exception) {
			throw new UnauthorizedException("Invalid access token");
		}
		if (!"access".equals(accessClaims.type())
				|| !authenticatedUserId.equals(accessClaims.subject())) {
			throw new UnauthorizedException("Invalid access token");
		}

		Instant now = Instant.now();
		Duration remainingLifetime = Duration.between(now, accessClaims.expiresAt());
		if (remainingLifetime.isZero() || remainingLifetime.isNegative()) {
			throw new UnauthorizedException("Invalid access token");
		}

		storedToken.setRevokedAt(now);
		refreshTokenRepository.saveAndFlush(storedToken);
		jwtBlacklistService.blacklist(accessClaims.jwtId(), remainingLifetime);
	}

	private String issueRefreshToken(UUID userId) {
		String refreshToken = jwtService.generateRefreshToken();
		JwtClaims refreshClaims = jwtService.extractClaims(refreshToken);

		RefreshToken storedRefreshToken = new RefreshToken();
		storedRefreshToken.setUserId(userId);
		storedRefreshToken.setTokenHash(hashRefreshToken(refreshToken));
		storedRefreshToken.setExpiresAt(refreshClaims.expiresAt());
		refreshTokenRepository.save(storedRefreshToken);
		return refreshToken;
	}

	private RefreshToken requireActiveRefreshToken(String refreshToken) {
		if (!jwtService.validateRefreshToken(refreshToken)) {
			throw new UnauthorizedException(INVALID_REFRESH_TOKEN_MESSAGE);
		}

		Instant now = Instant.now();
		return refreshTokenRepository.findByTokenHash(hashRefreshToken(refreshToken))
				.filter(token -> token.getRevokedAt() == null)
				.filter(token -> token.getExpiresAt().isAfter(now))
				.orElseThrow(() -> new UnauthorizedException(INVALID_REFRESH_TOKEN_MESSAGE));
	}

	private String hashRefreshToken(String refreshToken) {
		try {
			byte[] digest = MessageDigest.getInstance("SHA-256")
					.digest(refreshToken.getBytes(StandardCharsets.UTF_8));
			return HexFormat.of().formatHex(digest);
		}
		catch (NoSuchAlgorithmException exception) {
			throw new IllegalStateException("SHA-256 is not available", exception);
		}
	}
}
