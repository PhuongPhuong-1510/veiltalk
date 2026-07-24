package com.veiltalk.messaging;

import java.util.UUID;

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
	java.util.Optional<Conversation> findActivePair(
			@Param("userAId") UUID userAId,
			@Param("userBId") UUID userBId);

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
