package com.veiltalk.auth;

import java.util.Locale;
import java.util.Set;
import java.util.regex.Pattern;

import org.springframework.stereotype.Component;

@Component
public class UsernamePolicy {

	private static final Pattern FORMAT = Pattern.compile("^[a-z0-9][a-z0-9._]*[a-z0-9]$");
	private static final Pattern CONSECUTIVE_SEPARATORS = Pattern.compile("(\\.\\.|__|\\._|_\\.)");
	private static final Set<String> RESERVED = Set.of(
			"admin", "administrator", "support", "system", "veiltalk", "kokoro", "moderator", "security");

	public String normalizeAndValidate(String rawUsername) {
		String username = rawUsername == null ? "" : rawUsername.trim().toLowerCase(Locale.ROOT);
		if (username.length() < 3 || username.length() > 30
				|| !FORMAT.matcher(username).matches()
				|| CONSECUTIVE_SEPARATORS.matcher(username).find()
				|| RESERVED.contains(username)) {
			throw new ValidationException(
					"Username must be 3-30 characters using lowercase letters, numbers, dots or underscores");
		}
		return username;
	}

	public String normalizeSearchPrefix(String rawQuery) {
		String query = rawQuery == null ? "" : rawQuery.trim().toLowerCase(Locale.ROOT);
		if (query.startsWith("@")) {
			query = query.substring(1);
		}
		if (query.length() < 3 || query.length() > 30 || !query.matches("^[a-z0-9._]+$")) {
			throw new ValidationException("Username search query must contain 3-30 valid characters");
		}
		return query;
	}
}
