package com.veiltalk.avatar;

import java.io.ByteArrayInputStream;

import org.springframework.stereotype.Component;

import com.veiltalk.video.MinioProperties;

import io.minio.GetObjectArgs;
import io.minio.MinioClient;
import io.minio.PutObjectArgs;
import io.minio.RemoveObjectArgs;

@Component
public class MinioAvatarPortraitStorage implements AvatarPortraitStorage {
	private final MinioClient client;
	private final MinioProperties properties;

	public MinioAvatarPortraitStorage(MinioClient client, MinioProperties properties) {
		this.client = client;
		this.properties = properties;
	}

	@Override
	public void put(String objectKey, byte[] png) {
		try (var input = new ByteArrayInputStream(png)) {
			client.putObject(PutObjectArgs.builder()
					.bucket(properties.bucket())
					.object(objectKey)
					.contentType("image/png")
					.stream(input, png.length, -1)
					.build());
		} catch (Exception exception) {
			throw new AvatarStorageException("Could not store avatar portrait", exception);
		}
	}

	@Override
	public byte[] get(String objectKey) {
		try (var input = client.getObject(GetObjectArgs.builder()
				.bucket(properties.bucket()).object(objectKey).build())) {
			return input.readAllBytes();
		} catch (Exception exception) {
			throw new AvatarStorageException("Could not read avatar portrait", exception);
		}
	}

	@Override
	public void remove(String objectKey) {
		try {
			client.removeObject(RemoveObjectArgs.builder()
					.bucket(properties.bucket()).object(objectKey).build());
		} catch (Exception exception) {
			throw new AvatarStorageException("Could not remove avatar portrait", exception);
		}
	}
}
