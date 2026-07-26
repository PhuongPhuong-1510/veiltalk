// Cầu nối signaling -> backend cho P3-T04. Khi A gửi CALL_OFFER, signaling gọi
// backend TRƯỚC khi relay CALL_OFFER tới B qua Signaling WS (B thường CHƯA mở
// Signaling WS lúc này — đó chính là lý do endpoint này tồn tại: backend đẩy
// CALL_INCOMING qua Messaging WS, kênh B luôn giữ thường trực).
//
// Kết quả trả về được gộp thành 2 trạng thái duy nhất cho caller: "notified" hay
// "failed". Signaling KHÔNG phân biệt "callee không tồn tại" (backend trả 404)
// với "backend lỗi/timeout" — cả hai đều là "failed", để không rò rỉ sự tồn tại
// tài khoản qua kênh CALL_OFFER (anti-enumeration áp ở ranh giới signaling->client).
function createCallNotifyClient({ backendUrl, secret, timeoutMs = 2500, fetchImpl = fetch, log = console.error }) {
  if (!backendUrl) {
    throw new Error("backendUrl is required to create the call notify client");
  }
  if (!secret) {
    throw new Error("secret is required to create the call notify client");
  }

  async function notify(callerId, calleeId) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchImpl(`${backendUrl}/internal/call/notify`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${secret}`,
        },
        body: JSON.stringify({ caller_id: callerId, callee_id: calleeId }),
        signal: controller.signal,
      });
      return response.ok ? "notified" : "failed";
    } catch (error) {
      log(`Call notify request failed: ${error.message}`);
      return "failed";
    } finally {
      clearTimeout(timeout);
    }
  }

  return { notify };
}

module.exports = { createCallNotifyClient };
