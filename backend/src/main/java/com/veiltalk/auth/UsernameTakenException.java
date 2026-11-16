package com.veiltalk.auth;

public class UsernameTakenException extends RuntimeException {

	public UsernameTakenException() {
		super("Username is already in use");
	}
}
