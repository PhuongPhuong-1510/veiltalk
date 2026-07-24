package com.veiltalk.messaging;

import java.util.UUID;

import org.springframework.data.domain.Pageable;
import org.springframework.data.domain.Slice;
import org.springframework.data.jpa.repository.JpaRepository;

public interface MessageRepository extends JpaRepository<Message, UUID> {

	Slice<Message> findByConversationIdAndDeletedAtIsNullOrderByClientTimestampAsc(
			UUID conversationId,
			Pageable pageable);
}
