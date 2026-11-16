// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useAuthStore } from "../../lib/store/authStore";
import HomeUserFinder from "./HomeUserFinder";

const api = vi.hoisted(() => ({ searchUsers: vi.fn(), searchUsernames: vi.fn(), createConversation: vi.fn() }));
vi.mock("../../lib/api", async () => {
  const actual = await vi.importActual<typeof import("../../lib/api")>("../../lib/api");
  return {
    ...actual,
    usersApi: { searchUsers: api.searchUsers, searchUsernames: api.searchUsernames },
    conversationsApi: { createOrGetConversation: api.createConversation },
  };
});

let root: Root;
let container: HTMLDivElement;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  localStorage.clear();
  useAuthStore.setState({
    user: { id: "user-1", email: "me@example.com", display_name: "Me", role: "user", created_at: "2026-01-01T00:00:00Z" },
    status: "authenticated",
  });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  api.searchUsers.mockReset(); api.searchUsernames.mockReset(); api.createConversation.mockReset();
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it("hiển thị và xóa lịch sử tìm kiếm riêng của tài khoản", async () => {
  localStorage.setItem("veiltalk-user-search-history:user-1", JSON.stringify(["@kokoro", "friend@example.com"]));
  await act(async () => root.render(<HomeUserFinder onConversationCreated={vi.fn()} />));
  expect(container.textContent).toContain("Tìm kiếm gần đây");
  expect(container.textContent).toContain("@kokoro");
  const remove = container.querySelector('button[aria-label="Xóa @kokoro khỏi lịch sử"]') as HTMLButtonElement;
  await act(async () => remove.click());
  expect(JSON.parse(localStorage.getItem("veiltalk-user-search-history:user-1") ?? "[]")).toEqual(["friend@example.com"]);
});

it("lưu email đã tìm thành công vào lịch sử", async () => {
  api.searchUsers.mockResolvedValue({ found: true, user: { id: "friend-1", display_name: "Friend" } });
  await act(async () => root.render(<HomeUserFinder onConversationCreated={vi.fn()} />));
  const input = container.querySelector("input") as HTMLInputElement;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(input, "friend@example.com");
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () => (container.querySelector("form") as HTMLFormElement).requestSubmit());
  expect(api.searchUsers).toHaveBeenCalledWith("friend@example.com");
  expect(JSON.parse(localStorage.getItem("veiltalk-user-search-history:user-1") ?? "[]")).toEqual(["friend@example.com"]);
});
