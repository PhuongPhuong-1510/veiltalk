package com.veiltalk.user;

import com.fasterxml.jackson.annotation.JsonSetter;

import jakarta.validation.constraints.Pattern;

public class UserSettingsRequest {

	private Boolean discoverable;
	private Boolean emailNotifications;

	@Pattern(regexp = "^(dark|light|system)$")
	private String theme;

	private boolean themeProvided;

	public Boolean getDiscoverable() {
		return discoverable;
	}

	public void setDiscoverable(Boolean discoverable) {
		this.discoverable = discoverable;
	}

	public Boolean getEmailNotifications() {
		return emailNotifications;
	}

	@JsonSetter("email_notifications")
	public void setEmailNotifications(Boolean emailNotifications) {
		this.emailNotifications = emailNotifications;
	}

	public String getTheme() {
		return theme;
	}

	@JsonSetter("theme")
	public void setTheme(String theme) {
		themeProvided = true;
		this.theme = theme == null ? "" : theme;
	}

	public boolean isThemeProvided() {
		return themeProvided;
	}
}
