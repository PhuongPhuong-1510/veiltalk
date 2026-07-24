package com.veiltalk.auth;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.HexFormat;

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

	private final UserRepository userRepository;
	private final RefreshTokenRepository refreshTokenRepository;
	private final AvatarProfileRepository avatarProfileRepository;
	private final JwtService jwtService;
	private final PasswordEncoder passwordEncoder;
	private final EntityManager entityManager;

	public AuthService(
			UserRepository userRepository,
			RefreshTokenRepository refreshTokenRepository,
			AvatarProfileRepository avatarProfileRepository,
			JwtService jwtService,
			PasswordEncoder passwordEncoder,
			EntityManager entityManager) {
		this.userRepository = userRepository;
		this.refreshTokenRepository = refreshTokenRepository;
		this.avatarProfileRepository = avatarProfileRepository;
		this.jwtService = jwtService;
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
		String refreshToken = jwtService.generateRefreshToken();
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
		String refreshToken = jwtService.generateRefreshToken();
		JwtClaims refreshClaims = jwtService.extractClaims(refreshToken);

		RefreshToken storedRefreshToken = new RefreshToken();
		storedRefreshToken.setUserId(user.getId());
		storedRefreshToken.setTokenHash(hashRefreshToken(refreshToken));
		storedRefreshToken.setExpiresAt(refreshClaims.expiresAt());
		refreshTokenRepository.save(storedRefreshToken);

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
