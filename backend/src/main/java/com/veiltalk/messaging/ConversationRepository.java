package com.veiltalk.messaging;

import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

public interface ConversationRepository extends JpaRepository<Conversation, UUID> {

	@Query("""
			SELECT conversation
			FROM Conversation conversation
			WHERE conversation.userAId = :userAId
				AND conversation.userBId = :userBId
				AND conversation.deletedAt IS NULL
			""")
	Optional<Conversation> findActivePair(
			@Param("userAId") UUID userAId,
			@Param("userBId") UUID userBId);

	Optional<Conversation> findByIdAndDeletedAtIsNull(UUID id);

	@Query("""
			SELECT conversation
			FROM Conversation conversation
			WHERE (conversation.userAId = :userId OR conversation.userBId = :userId)
				AND conversation.deletedAt IS NULL
			ORDER BY conversation.updatedAt DESC, conversation.id DESC
			""")
	List<Conversation> findActiveForUser(
			@Param("userId") UUID userId,
			Pageable pageable);

	@Query("""
			SELECT conversation
			FROM Conversation conversation
			WHERE (conversation.userAId = :userId OR conversation.userBId = :userId)
				AND conversation.deletedAt IS NULL
				AND (
					conversation.updatedAt < :cursorUpdatedAt
					OR (
						conversation.updatedAt = :cursorUpdatedAt
						AND conversation.id < :cursorId
					)
				)
			ORDER BY conversation.updatedAt DESC, conversation.id DESC
			""")
	List<Conversation> findActiveForUserAfter(
			@Param("userId") UUID userId,
			@Param("cursorUpdatedAt") Instant cursorUpdatedAt,
			@Param("cursorId") UUID cursorId,
			Pageable pageable);

	@Modifying
	@Query(value = """
			INSERT INTO conversations (id, user_a_id, user_b_id)
			VALUES (:id, :userAId, :userBId)
			ON CONFLICT DO NOTHING
			""", nativeQuery = true)
	int insertIfAbsent(
			@Param("id") UUID id,
			@Param("userAId") UUID userAId,
			@Param("userBId") UUID userBId);
}
