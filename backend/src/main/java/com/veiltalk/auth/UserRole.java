package com.veiltalk.auth;

public enum UserRole {
	USER("user"),
	ADMIN("admin");

	private final String databaseValue;

	UserRole(String databaseValue) {
		this.databaseValue = databaseValue;
	}

	public String getDatabaseValue() {
		return databaseValue;
	}

	public static UserRole fromDatabaseValue(String value) {
		for (UserRole role : values()) {
			if (role.databaseValue.equals(value)) {
				return role;
			}
		}
		throw new IllegalArgumentException("Unknown user role: " + value);
	}
}
