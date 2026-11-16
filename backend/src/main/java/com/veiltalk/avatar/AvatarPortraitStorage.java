package com.veiltalk.avatar;

public interface AvatarPortraitStorage {
	void put(String objectKey, byte[] png);
	byte[] get(String objectKey);
	void remove(String objectKey);
}
