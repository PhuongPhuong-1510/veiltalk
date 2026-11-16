package com.veiltalk.user;

public class UsernameRequiredException extends RuntimeException {

	public UsernameRequiredException() {
		super("Choose a username before enabling username search");
	}
}
