package com.veiltalk.user;

import java.time.Duration;
import java.util.UUID;

import com.veiltalk.auth.UserRepository;

import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class UserSearchService {

	private final UserRepository userRepository;
	private final UserSearchRateLimiter rateLimiter;

	public UserSearchService(
			UserRepository userRepository,
			UserSearchRateLimiter rateLimiter) {
		this.userRepository = userRepository;
		this.rateLimiter = rateLimiter;
	}

	@Transactional(readOnly = true)
	public SearchResult search(UUID authenticatedUserId, UserSearchRequest request) {
		Duration retryAfter = rateLimiter.consume(authenticatedUserId);
		if (!retryAfter.isZero()) {
			return SearchResult.rateLimited(retryAfter);
		}

		return userRepository.findByEmailAndIsDiscoverableTrueAndDeletedAtIsNull(request.email())
				.map(user -> SearchResult.found(new UserSearchResponse(
						true,
						new UserSearchResponse.UserSummary(user.getId(), user.getDisplayName()))))
				.orElseGet(() -> SearchResult.success(new UserSearchResponse(false, null)));
	}

	public record SearchResult(
			UserSearchResponse response,
			Duration retryAfter) {

		static SearchResult found(UserSearchResponse response) {
			return new SearchResult(response, Duration.ZERO);
		}

		static SearchResult success(UserSearchResponse response) {
			return new SearchResult(response, Duration.ZERO);
		}

		static SearchResult rateLimited(Duration retryAfter) {
			return new SearchResult(null, retryAfter);
		}
	}
}
