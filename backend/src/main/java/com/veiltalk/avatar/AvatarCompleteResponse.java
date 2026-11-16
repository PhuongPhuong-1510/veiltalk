package com.veiltalk.avatar;

import com.veiltalk.user.UserProfileResponse;

public record AvatarCompleteResponse(AvatarProfileResponse profile, UserProfileResponse user) {}
