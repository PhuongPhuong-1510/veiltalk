package com.veiltalk.auth;

import java.lang.annotation.ElementType;
import java.lang.annotation.Retention;
import java.lang.annotation.RetentionPolicy;
import java.lang.annotation.Target;

import jakarta.validation.Constraint;
import jakarta.validation.Payload;

@Target({ElementType.FIELD, ElementType.PARAMETER, ElementType.RECORD_COMPONENT})
@Retention(RetentionPolicy.RUNTIME)
@Constraint(validatedBy = ValidTextControlsValidator.class)
public @interface ValidTextControls {
	String message() default "Invalid control character";
	Class<?>[] groups() default {};
	Class<? extends Payload>[] payload() default {};
	boolean allowMessageFormatting() default false;
}
