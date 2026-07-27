import { describe, expect, it } from "vitest";
import { ApiError } from "../api/types";
import {
  GENERIC_LOGIN_ERROR,
  getLoginErrorMessage,
  getPasswordStrength,
  getPostRestorePath,
  getRegistrationEmailError,
  isRegistrationValid,
} from "./authFlow";

describe("auth flow", () => {
  it("đưa session hợp lệ tới home", () => {
    expect(getPostRestorePath("authenticated")).toBe("/home");
  });

  it("đưa session thiếu/hết hạn tới welcome", () => {
    expect(getPostRestorePath("unauthenticated")).toBe("/welcome");
    expect(getPostRestorePath("idle")).toBe("/welcome");
  });

  it("luôn dùng thông báo đăng nhập chung để chống dò tài khoản", () => {
    expect(getLoginErrorMessage()).toBe(GENERIC_LOGIN_ERROR);
    expect(getLoginErrorMessage()).not.toContain("tồn tại");
  });
});

describe("register flow", () => {
  it("đánh giá mật khẩu theo bốn mức", () => {
    expect(getPasswordStrength("").score).toBe(0);
    expect(getPasswordStrength("abcdefgh").score).toBe(1);
    expect(getPasswordStrength("Abcdefgh").score).toBe(2);
    expect(getPasswordStrength("Abcdefg1").score).toBe(3);
    expect(getPasswordStrength("Abcdefg1!").score).toBe(4);
  });

  it("chỉ cho đăng ký khi cả ba field hợp lệ", () => {
    expect(isRegistrationValid("user@example.com", "Abcdefg1", "Luna")).toBe(true);
    expect(isRegistrationValid("invalid", "Abcdefg1", "Luna")).toBe(false);
    expect(isRegistrationValid("user@example.com", "abcdefgh", "Luna")).toBe(false);
    expect(isRegistrationValid("user@example.com", "Abcdefg1", " ")).toBe(false);
  });

  it("chỉ map conflict email thành lỗi inline", () => {
    expect(getRegistrationEmailError(new ApiError(409, "EMAIL_EXISTS", "conflict")))
      .toBe("Email này đã được sử dụng.");
    expect(getRegistrationEmailError(new ApiError(400, "VALIDATION_ERROR", "bad"))).toBeNull();
  });
});
