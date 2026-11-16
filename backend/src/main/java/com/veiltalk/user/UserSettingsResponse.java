package com.veiltalk.user;

import com.fasterxml.jackson.annotation.JsonProperty;

public record UserSettingsResponse(
		boolean discoverable,
		@JsonProperty("username_searchable") boolean usernameSearchable,
		@JsonProperty("email_notifications") boolean emailNotifications,
		String theme) {
}
