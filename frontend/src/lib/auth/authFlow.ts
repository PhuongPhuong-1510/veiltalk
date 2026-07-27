import type { AuthStatus } from "../store/authStore";
import { ApiError } from "../api/types";

export const GENERIC_LOGIN_ERROR = "Email hoặc mật khẩu không đúng. Vui lòng thử lại.";

export function getLoginErrorMessage(): string {
  return GENERIC_LOGIN_ERROR;
}

export function getPostRestorePath(status: AuthStatus): "/home" | "/welcome" {
  return status === "authenticated" ? "/home" : "/welcome";
}

export interface PasswordStrength {
  score: 0 | 1 | 2 | 3 | 4;
  label: string;
}

export function getPasswordStrength(password: string): PasswordStrength {
  if (!password) return { score: 0, label: "Tối thiểu 8 ký tự, có chữ hoa và số" };

  const rules = [
    password.length >= 8,
    /[A-Z]/.test(password),
    /\d/.test(password),
    /[^A-Za-z0-9]/.test(password) || password.length >= 12,
  ];
  const score = rules.filter(Boolean).length as PasswordStrength["score"];

  if (password.length < 8) return { score, label: "Cần ít nhất 8 ký tự" };
  if (!/[A-Z]/.test(password)) return { score, label: "Cần ít nhất 1 chữ hoa" };
  if (!/\d/.test(password)) return { score, label: "Cần ít nhất 1 chữ số" };
  if (score < 4) return { score, label: "Mật khẩu đạt yêu cầu" };
  return { score, label: "Mật khẩu mạnh" };
}

export function isRegistrationValid(email: string, password: string, displayName: string): boolean {
  const normalizedEmail = email.trim();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)
    && password.length >= 8
    && /[A-Z]/.test(password)
    && /\d/.test(password)
    && displayName.trim().length >= 1
    && displayName.trim().length <= 100;
}

export function getRegistrationEmailError(error: unknown): string | null {
  return error instanceof ApiError && error.status === 409
    ? "Email này đã được sử dụng."
    : null;
}
