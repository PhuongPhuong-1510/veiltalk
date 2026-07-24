package com.veiltalk.messaging;

import java.time.Instant;
import java.util.Collection;
import java.util.List;
import java.util.UUID;

import org.springframework.data.domain.Pageable;
import org.springframework.data.domain.Slice;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

public interface MessageRepository extends JpaRepository<Message, UUID> {

	Slice<Message> findByConversationIdAndDeletedAtIsNullOrderByClientTimestampAsc(
			UUID conversationId,
			Pageable pageable);

	@Query(value = """
			SELECT DISTINCT ON (conversation_id)
				conversation_id AS conversationId,
				content,
				sender_id AS senderId,
				client_timestamp AS clientTimestamp,
				status
			FROM messages
			WHERE conversation_id IN (:conversationIds)
				AND deleted_at IS NULL
			ORDER BY conversation_id, client_timestamp DESC, id DESC
			""", nativeQuery = true)
	List<LatestMessageView> findLatestForConversations(
			@Param("conversationIds") Collection<UUID> conversationIds);

	interface LatestMessageView {

		UUID getConversationId();

		String getContent();

		UUID getSenderId();

		Instant getClientTimestamp();

		String getStatus();
	}
}
