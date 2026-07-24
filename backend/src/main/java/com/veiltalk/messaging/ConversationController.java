package com.veiltalk.messaging;

import java.util.UUID;

import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RestController;

import jakarta.validation.Valid;

@RestController
public class ConversationController {

	private final ConversationService conversationService;
	private final MessageService messageService;

	public ConversationController(
			ConversationService conversationService,
			MessageService messageService) {
		this.conversationService = conversationService;
		this.messageService = messageService;
	}

	@PostMapping("/conversations")
	ResponseEntity<ConversationResponse> create(
			Authentication authentication,
			@Valid @RequestBody CreateConversationRequest request) {
		ConversationService.CreateResult result = conversationService.createOrGet(
				(UUID) authentication.getPrincipal(),
				request);
		return ResponseEntity
				.status(result.created() ? HttpStatus.CREATED : HttpStatus.OK)
				.body(result.response());
	}

	@GetMapping("/conversations")
	ConversationListResponse getConversations(
			Authentication authentication,
			@RequestParam(required = false) String cursor,
			@RequestParam(defaultValue = "20") String limit) {
		return conversationService.getConversations(
				(UUID) authentication.getPrincipal(),
				cursor,
				limit);
	}

	@GetMapping("/conversations/{id}")
	ConversationDetailResponse getConversation(
			Authentication authentication,
			@PathVariable UUID id) {
		return conversationService.getConversation(
				(UUID) authentication.getPrincipal(),
				id);
	}

	@PostMapping("/conversations/{id}/messages")
	ResponseEntity<MessageResponse> createMessage(
			Authentication authentication,
			@PathVariable UUID id,
			@Valid @RequestBody CreateMessageRequest request) {
		MessageService.CreateResult result = messageService.create(
				(UUID) authentication.getPrincipal(),
				id,
				request);
		return ResponseEntity
				.status(result.created() ? HttpStatus.CREATED : HttpStatus.OK)
				.body(result.response());
	}

	@GetMapping("/conversations/{id}/messages")
	MessageListResponse getMessages(
			Authentication authentication,
			@PathVariable UUID id,
			@RequestParam(required = false) String cursor,
			@RequestParam(defaultValue = "30") String limit) {
		return messageService.getMessages(
				(UUID) authentication.getPrincipal(),
				id,
				cursor,
				limit);
	}
}
