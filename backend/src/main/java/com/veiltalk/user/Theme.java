package com.veiltalk.user;

public enum Theme {
	DARK("dark"),
	LIGHT("light"),
	SYSTEM("system");

	private final String databaseValue;

	Theme(String databaseValue) {
		this.databaseValue = databaseValue;
	}

	public String getDatabaseValue() {
		return databaseValue;
	}

	public static Theme fromDatabaseValue(String value) {
		for (Theme theme : values()) {
			if (theme.databaseValue.equals(value)) {
				return theme;
			}
		}
		throw new IllegalArgumentException("Unknown theme: " + value);
	}
}
