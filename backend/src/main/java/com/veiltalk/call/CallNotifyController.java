package com.veiltalk.call;

import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/internal/call")
public class CallNotifyController {

	private final CallNotifyService callNotifyService;

	public CallNotifyController(CallNotifyService callNotifyService) {
		this.callNotifyService = callNotifyService;
	}

	@PostMapping("/notify")
	ResponseEntity<Void> notify(@RequestBody CallNotifyRequest request) {
		callNotifyService.notify(request);
		return ResponseEntity.noContent().build();
	}
}
