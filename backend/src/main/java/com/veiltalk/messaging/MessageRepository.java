package com.veiltalk.messaging;

import java.time.Instant;
import java.util.Collection;
import java.util.List;
import java.util.UUID;

import org.springframework.data.domain.Pageable;
import org.springframework.data.domain.Slice;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import jakarta.persistence.LockModeType;

public interface MessageRepository extends JpaRepository<Message, UUID> {

	@Modifying
	@Query(value = """
			INSERT INTO messages
				(id, conversation_id, sender_id, content, status, client_timestamp)
			VALUES
				(:id, :conversationId, :senderId, :content, 'sent', :clientTimestamp)
			ON CONFLICT (id) DO NOTHING
			""", nativeQuery = true)
	int insertIfAbsent(
			@Param("id") UUID id,
			@Param("conversationId") UUID conversationId,
			@Param("senderId") UUID senderId,
			@Param("content") String content,
			@Param("clientTimestamp") Instant clientTimestamp);

	@Lock(LockModeType.PESSIMISTIC_WRITE)
	@Query("""
			SELECT message
			FROM Message message
			WHERE message.id = :messageId
				AND message.conversationId = :conversationId
				AND message.deletedAt IS NULL
			""")
	java.util.Optional<Message> findActiveForUpdate(
			@Param("messageId") UUID messageId,
			@Param("conversationId") UUID conversationId);

	Slice<Message> findByConversationIdAndDeletedAtIsNullOrderByClientTimestampAsc(
			UUID conversationId,
			Pageable pageable);

	@Query(value = """
			SELECT *
			FROM messages
			WHERE conversation_id = :conversationId
				AND deleted_at IS NULL
			ORDER BY client_timestamp DESC, id DESC
			""", nativeQuery = true)
	List<Message> findLatestActive(
			@Param("conversationId") UUID conversationId,
			Pageable pageable);

	@Query(value = """
			SELECT *
			FROM messages
			WHERE conversation_id = :conversationId
				AND deleted_at IS NULL
				AND (client_timestamp, id) < (:clientTimestamp, :messageId)
			ORDER BY client_timestamp DESC, id DESC
			""", nativeQuery = true)
	List<Message> findActiveBefore(
			@Param("conversationId") UUID conversationId,
			@Param("clientTimestamp") Instant clientTimestamp,
			@Param("messageId") UUID messageId,
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
