package com.veiltalk.user;

import java.time.Duration;
import java.util.ArrayList;
import java.util.UUID;

import com.veiltalk.auth.TooManyRequestsException;
import com.veiltalk.auth.UsernamePolicy;

import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class UsernameSearchService {

	private final UsernamePolicy usernamePolicy;
	private final UsernameSearchRepository repository;
	private final UsernameSearchRateLimiter rateLimiter;

	public UsernameSearchService(
			UsernamePolicy usernamePolicy,
			UsernameSearchRepository repository,
			UsernameSearchRateLimiter rateLimiter) {
		this.usernamePolicy = usernamePolicy;
		this.repository = repository;
		this.rateLimiter = rateLimiter;
	}

	@Transactional(readOnly = true)
	public UsernameSearchResponse search(UUID requesterId, UsernameSearchRequest request) {
		Duration retryAfter = rateLimiter.consume(requesterId);
		if (!retryAfter.isZero()) {
			throw new TooManyRequestsException(retryAfter);
		}

		String query = usernamePolicy.normalizeSearchPrefix(request.query());
		int limit = request.effectiveLimit();
		var matches = new ArrayList<>(repository.search(requesterId, query, limit + 1));
		boolean truncated = matches.size() > limit;
		if (truncated) {
			matches.remove(matches.size() - 1);
		}
		return new UsernameSearchResponse(matches, new UsernameSearchResponse.Meta(limit, truncated));
	}
}
