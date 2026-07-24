package com.veiltalk.user;

import com.fasterxml.jackson.annotation.JsonProperty;
import com.fasterxml.jackson.annotation.JsonSetter;

import jakarta.validation.constraints.Size;

public class UserProfileUpdateRequest {

	@Size(min = 1, max = 100)
	private String displayName;

	private String avatarUrl;
	private boolean displayNameProvided;
	private boolean avatarUrlProvided;

	public String getDisplayName() {
		return displayName;
	}

	@JsonSetter("display_name")
	public void setDisplayName(String displayName) {
		displayNameProvided = true;
		this.displayName = displayName == null ? "" : displayName;
	}

	public String getAvatarUrl() {
		return avatarUrl;
	}

	@JsonSetter("avatar_url")
	public void setAvatarUrl(String avatarUrl) {
		avatarUrlProvided = true;
		this.avatarUrl = avatarUrl;
	}

	@JsonProperty(access = JsonProperty.Access.READ_ONLY)
	public boolean isDisplayNameProvided() {
		return displayNameProvided;
	}

	@JsonProperty(access = JsonProperty.Access.READ_ONLY)
	public boolean isAvatarUrlProvided() {
		return avatarUrlProvided;
	}
}
