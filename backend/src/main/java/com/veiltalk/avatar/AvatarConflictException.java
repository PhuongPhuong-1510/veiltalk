package com.veiltalk.avatar;

public class AvatarConflictException extends RuntimeException {
	private final String code;

	public AvatarConflictException(String code, String message) {
		super(message);
		this.code = code;
	}

	public String code() { return code; }
}
