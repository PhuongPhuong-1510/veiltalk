// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import SearchScreen from "./SearchScreen";

const api = vi.hoisted(() => ({ searchUsers: vi.fn(), searchUsernames: vi.fn(), createOrGetConversation: vi.fn() }));
vi.mock("../../lib/api", () => ({
  usersApi: { searchUsers: api.searchUsers, searchUsernames: api.searchUsernames },
  conversationsApi: { createOrGetConversation: api.createOrGetConversation },
  ApiError: class extends Error { status = 429; },
}));

let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div"); document.body.append(container);
  root = createRoot(container);
  api.searchUsers.mockReset(); api.searchUsernames.mockReset(); api.createOrGetConversation.mockReset();
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove(); vi.useRealTimers(); vi.unstubAllGlobals();
});

it("searches by exact email, creates a conversation and opens it", async () => {
  api.searchUsers.mockResolvedValue({ found: true, user: { id: "u2", display_name: "B" } });
  api.createOrGetConversation.mockResolvedValue({ id: "conversation-1" });
  await act(async () => root.render(<MemoryRouter initialEntries={["/search"]}><Routes>
    <Route path="/search" element={<SearchScreen />} />
    <Route path="/home" element={<div>conversation opened</div>} />
  </Routes></MemoryRouter>));
  const input = container.querySelector('#user-search')! as HTMLInputElement;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(input, "friend@example.com");
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () => { container.querySelector('button[type="submit"]')!.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
  expect(api.searchUsers).toHaveBeenCalledWith("friend@example.com");
  await act(async () => { [...container.querySelectorAll("button")].find((button) => button.textContent === "Nhắn tin")!.click(); });
  expect(api.createOrGetConversation).toHaveBeenCalledWith("u2");
  expect(container.textContent).toContain("conversation opened");
});

it("debounces username prefix search and renders username results", async () => {
  vi.useFakeTimers();
  api.searchUsernames.mockResolvedValue({
    data: [{ id: "u2", username: "friend_name", display_name: "Friend" }],
    meta: { limit: 10, truncated: false },
  });
  await act(async () => root.render(<MemoryRouter><SearchScreen /></MemoryRouter>));
  const input = container.querySelector('#user-search')! as HTMLInputElement;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(input, "friend_");
    input.dispatchEvent(new Event("input", { bubbles: true }));
    await vi.advanceTimersByTimeAsync(350);
  });
  expect(api.searchUsernames).toHaveBeenCalledWith("friend_", expect.any(AbortSignal));
  expect(container.textContent).toContain("@friend_name");
  vi.useRealTimers();
});
