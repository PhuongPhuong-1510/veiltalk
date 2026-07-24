package com.veiltalk.video;

public enum VideoStatus {
	RECORDING("recording"),
	PROCESSING("processing"),
	READY("ready"),
	FAILED("failed");

	private final String databaseValue;

	VideoStatus(String databaseValue) {
		this.databaseValue = databaseValue;
	}

	public String getDatabaseValue() {
		return databaseValue;
	}

	public static VideoStatus fromDatabaseValue(String value) {
		for (VideoStatus status : values()) {
			if (status.databaseValue.equals(value)) {
				return status;
			}
		}
		throw new IllegalArgumentException("Unknown video status: " + value);
	}
}
