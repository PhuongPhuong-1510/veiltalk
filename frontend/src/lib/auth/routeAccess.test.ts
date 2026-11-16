import { describe, expect, it } from "vitest";
import { getAuthRouteRedirect } from "./routeAccess";

describe("auth route access", () => {
  it("đưa người đã đăng nhập ra khỏi các màn dành cho khách", () => {
    expect(getAuthRouteRedirect("authenticated", "guest", true)).toBe("/home");
  });

  it("cho khách sử dụng welcome, login và register", () => {
    expect(getAuthRouteRedirect("unauthenticated", "guest", false)).toBeNull();
  });

  it("đưa người chưa đăng nhập về login khi mở route bảo vệ", () => {
    expect(getAuthRouteRedirect("unauthenticated", "protected", false)).toBe("/login");
  });

  it("cho người đã đăng nhập sử dụng route bảo vệ", () => {
    expect(getAuthRouteRedirect("authenticated", "protected", true)).toBeNull();
  });

  it("chưa redirect trong khi đang khôi phục session", () => {
    expect(getAuthRouteRedirect("idle", "guest", false)).toBeNull();
    expect(getAuthRouteRedirect("idle", "protected", false)).toBeNull();
  });

  it("chỉ cho tài khoản chưa có avatar vào luồng thiết lập sau đăng ký", () => {
    expect(getAuthRouteRedirect("authenticated", "avatar-setup", false)).toBeNull();
    expect(getAuthRouteRedirect("authenticated", "avatar-setup", true)).toBe("/home");
  });

  it("buộc tài khoản chưa có avatar hoàn tất thiết lập trước khi vào ứng dụng", () => {
    expect(getAuthRouteRedirect("authenticated", "protected", false)).toBe("/avatar/setup");
    expect(getAuthRouteRedirect("authenticated", "guest", false)).toBe("/avatar/setup");
  });
});
