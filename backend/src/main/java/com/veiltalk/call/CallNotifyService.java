package com.veiltalk.call;

import java.util.UUID;

import org.springframework.stereotype.Service;

import com.veiltalk.auth.NotFoundException;
import com.veiltalk.auth.User;
import com.veiltalk.auth.UserRepository;
import com.veiltalk.messaging.MessageRealtimePublisher;

@Service
public class CallNotifyService {

	private static final String CALLEE_NOT_FOUND_MESSAGE = "Callee not found";

	private final UserRepository userRepository;
	private final MessageRealtimePublisher realtimePublisher;

	public CallNotifyService(UserRepository userRepository, MessageRealtimePublisher realtimePublisher) {
		this.userRepository = userRepository;
		this.realtimePublisher = realtimePublisher;
	}

	public void notify(CallNotifyRequest request) {
		User caller = userRepository.findByIdAndDeletedAtIsNull(request.callerId())
				.orElseThrow(() -> new NotFoundException(CALLEE_NOT_FOUND_MESSAGE));
		User callee = userRepository.findByIdAndDeletedAtIsNull(request.calleeId())
				.orElseThrow(() -> new NotFoundException(CALLEE_NOT_FOUND_MESSAGE));

		UUID callSessionId = CallSessionIdGenerator.generate(caller.getId(), callee.getId());
		realtimePublisher.publishCallIncoming(
				callee.getId(),
				caller.getId(),
				caller.getDisplayName(),
				callSessionId);
	}
}
