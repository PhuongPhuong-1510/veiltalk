package com.veiltalk.auth;

import jakarta.validation.ConstraintValidator;
import jakarta.validation.ConstraintValidatorContext;

public class ValidTextControlsValidator implements ConstraintValidator<ValidTextControls, String> {
	private boolean allowMessageFormatting;

	@Override
	public void initialize(ValidTextControls constraint) {
		allowMessageFormatting = constraint.allowMessageFormatting();
	}

	@Override
	public boolean isValid(String value, ConstraintValidatorContext context) {
		if (value == null) return true;
		for (int offset = 0; offset < value.length();) {
			int codePoint = value.codePointAt(offset);
			if (Character.getType(codePoint) == Character.CONTROL) {
				boolean formatting = allowMessageFormatting
						&& (codePoint == '\t' || codePoint == '\n'
								|| (codePoint == '\r' && offset + 1 < value.length() && value.charAt(offset + 1) == '\n'));
				if (!formatting) return false;
			}
			offset += Character.charCount(codePoint);
		}
		return true;
	}
}
