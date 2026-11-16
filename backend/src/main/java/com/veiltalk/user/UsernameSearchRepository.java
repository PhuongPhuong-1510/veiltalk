package com.veiltalk.user;

import java.util.List;
import java.util.UUID;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

@Repository
public class UsernameSearchRepository {

	private static final String SEARCH_SQL = """
			SELECT u.id, u.username, u.display_name,
			       COALESCE(NULLIF(BTRIM(u.avatar_url), ''),
			                '/models/avatar-thumbnails/' || ap.model_id || '.png') AS avatar_url
			FROM users u
			LEFT JOIN avatar_profiles ap ON ap.user_id = u.id
			WHERE u.deleted_at IS NULL
			  AND u.is_username_searchable = TRUE
			  AND u.username IS NOT NULL
			  AND u.id <> ?
			  AND u.username LIKE ? ESCAPE '\\'
			ORDER BY CASE WHEN u.username = ? THEN 0 ELSE 1 END,
			         u.username,
			         u.id
			LIMIT ?
			""";

	private final JdbcTemplate jdbcTemplate;

	public UsernameSearchRepository(JdbcTemplate jdbcTemplate) {
		this.jdbcTemplate = jdbcTemplate;
	}

	public List<UsernameSearchResponse.UserSummary> search(
			UUID requesterId,
			String normalizedQuery,
			int limitPlusOne) {
		String prefixPattern = escapeLikePattern(normalizedQuery) + "%";
		return jdbcTemplate.query(
				SEARCH_SQL,
				(resultSet, rowNumber) -> new UsernameSearchResponse.UserSummary(
						resultSet.getObject("id", UUID.class),
						resultSet.getString("username"),
						resultSet.getString("display_name"),
						resultSet.getString("avatar_url")),
				requesterId,
				prefixPattern,
				normalizedQuery,
				limitPlusOne);
	}

	static String escapeLikePattern(String value) {
		return value.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_");
	}
}
