package com.veiltalk.user;

import java.time.Instant;
import java.util.UUID;

import com.veiltalk.auth.RefreshTokenRepository;
import com.veiltalk.auth.UnauthorizedException;
import com.veiltalk.auth.User;
import com.veiltalk.auth.UserRepository;
import com.veiltalk.auth.UserTokenRevocationService;
import com.veiltalk.video.VideoAccountCleanupService;

import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class UserAccountService {

	private static final String INVALID_PASSWORD_MESSAGE = "Invalid password";
	private static final String INVALID_SESSION_MESSAGE = "Invalid session";

	private final UserRepository userRepository;
	private final RefreshTokenRepository refreshTokenRepository;
	private final PasswordEncoder passwordEncoder;
	private final UserTokenRevocationService userTokenRevocationService;
	private final VideoAccountCleanupService videoAccountCleanupService;

	public UserAccountService(
			UserRepository userRepository,
			RefreshTokenRepository refreshTokenRepository,
			PasswordEncoder passwordEncoder,
			UserTokenRevocationService userTokenRevocationService,
			VideoAccountCleanupService videoAccountCleanupService) {
		this.userRepository = userRepository;
		this.refreshTokenRepository = refreshTokenRepository;
		this.passwordEncoder = passwordEncoder;
		this.userTokenRevocationService = userTokenRevocationService;
		this.videoAccountCleanupService = videoAccountCleanupService;
	}

	@Transactional
	public void deleteAccount(UUID authenticatedUserId, DeleteAccountRequest request) {
		User user = userRepository.findByIdAndDeletedAtIsNull(authenticatedUserId)
				.orElseThrow(() -> new UnauthorizedException(INVALID_SESSION_MESSAGE));
		if (!passwordEncoder.matches(request.password(), user.getPasswordHash())) {
			throw new UnauthorizedException(INVALID_PASSWORD_MESSAGE);
		}

		Instant revokedAt = Instant.now();
		user.setDeletedAt(revokedAt);
		refreshTokenRepository.revokeAllActiveByUserId(authenticatedUserId, revokedAt);
		userRepository.saveAndFlush(user);
		userTokenRevocationService.revokeAllIssuedTokens(authenticatedUserId, revokedAt);

		// P2-T24: abort mọi phiên quay video còn dở. Chạy SAU khi soft-delete/revoke đã ghi
		// nhận ở trên — service này tự nuốt lỗi và dùng transaction riêng nên không kéo theo
		// rollback thao tác xóa tài khoản dù MinIO abort thất bại (API Design mục 4.5).
		videoAccountCleanupService.abortAllRecordingsForUser(authenticatedUserId);
	}
}
