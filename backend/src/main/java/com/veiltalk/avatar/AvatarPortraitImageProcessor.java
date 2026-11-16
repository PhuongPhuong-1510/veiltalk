package com.veiltalk.avatar;

import java.awt.image.BufferedImage;
import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;

import javax.imageio.ImageIO;

import org.springframework.stereotype.Component;

import com.veiltalk.auth.ValidationException;

@Component
public class AvatarPortraitImageProcessor {
	static final int SIZE = 512;
	static final int MAX_BYTES = 1_048_576;

	public byte[] validateAndSanitize(byte[] upload) {
		if (upload == null || upload.length == 0 || upload.length > MAX_BYTES || !isPng(upload)) {
			throw new ValidationException("Portrait must be a PNG no larger than 1 MB");
		}
		if (readInt(upload, 16) != SIZE || readInt(upload, 20) != SIZE) {
			throw new ValidationException("Portrait must be 512x512 pixels");
		}
		try {
			BufferedImage image = ImageIO.read(new ByteArrayInputStream(upload));
			if (image == null || image.getWidth() != SIZE || image.getHeight() != SIZE) {
				throw new ValidationException("Portrait must be 512x512 pixels");
			}
			BufferedImage sanitized = new BufferedImage(SIZE, SIZE, BufferedImage.TYPE_INT_ARGB);
			var graphics = sanitized.createGraphics();
			graphics.drawImage(image, 0, 0, null);
			graphics.dispose();
			var output = new ByteArrayOutputStream();
			if (!ImageIO.write(sanitized, "png", output)) {
				throw new ValidationException("Portrait PNG could not be encoded");
			}
			return output.toByteArray();
		} catch (ValidationException exception) {
			throw exception;
		} catch (Exception exception) {
			throw new ValidationException("Portrait is not a valid PNG");
		}
	}

	private boolean isPng(byte[] bytes) {
		byte[] signature = {(byte) 0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a};
		if (bytes.length < signature.length) return false;
		for (int i = 0; i < signature.length; i++) if (bytes[i] != signature[i]) return false;
		return true;
	}

	private int readInt(byte[] bytes, int offset) {
		if (bytes.length < offset + 4) return -1;
		return ((bytes[offset] & 0xff) << 24) | ((bytes[offset + 1] & 0xff) << 16)
				| ((bytes[offset + 2] & 0xff) << 8) | (bytes[offset + 3] & 0xff);
	}
}
