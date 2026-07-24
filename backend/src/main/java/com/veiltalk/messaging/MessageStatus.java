package com.veiltalk.messaging;

public enum MessageStatus {
	SENT("sent"),
	DELIVERED("delivered"),
	READ("read");

	private final String databaseValue;

	MessageStatus(String databaseValue) {
		this.databaseValue = databaseValue;
	}

	public String getDatabaseValue() {
		return databaseValue;
	}

	public static MessageStatus fromDatabaseValue(String value) {
		for (MessageStatus status : values()) {
			if (status.databaseValue.equals(value)) {
				return status;
			}
		}
		throw new IllegalArgumentException("Unknown message status: " + value);
	}
}
