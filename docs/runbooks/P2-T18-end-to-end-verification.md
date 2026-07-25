# P2-T18 — Xác minh end-to-end cuối

Ngày xác minh: 2026-07-25  
Branch: `task/P2-T18`

## Phạm vi

Lượt regression này chạy đúng phạm vi P2-T18, dùng PostgreSQL 16 và Redis thật trên
local, khởi động embedded Backend bằng random port và kết nối WebSocket thật.

Các luồng được bảo vệ:

- JWT query handshake, HTTP 401, origin và giới hạn frame 32 KiB;
- nhiều session cho một user;
- PING/PONG, token hết hạn hoặc bị revoke, missed heartbeat;
- Redis Pub/Sub fanout `NEW_MESSAGE`, `MESSAGE_STATUS_UPDATE` và readiness
  `CALL_INCOMING`;
- REST/DB commit → Redis → WebSocket, gồm recovery khi Redis listener gián đoạn;
- `TYPING`/`TYPING_STOP`, kiểm membership, không echo sender và không ghi DB;
- envelope `ERROR`, policy violation 1008 và message too big 1009;
- publisher best-effort, log và metric khi Redis publish lỗi.

## Lệnh

```powershell
cd backend
./mvnw "-Dtest=SecurityConfigTests,WebSocketAuthHandshakeInterceptorTests,MessagingWebSocketConfigTests,MessagingWebSocketHandshakeIntegrationTests,WebSocketSessionRegistryTests,WebSocketKeepAliveSchedulerTests,MessagingWebSocketLifecycleIntegrationTests,MessagingRedisSubscriberTests,MessagingWebSocketDeliveryIntegrationTests,MessageRealtimePublisherTests,MessagingWebSocketTypingIntegrationTests" test
```

## Kết quả

```text
Tests run: 50, Failures: 0, Errors: 0, Skipped: 0
BUILD SUCCESS
Total time: 32.079 s
```

Stack trace `Redis unavailable` xuất hiện trong output là lỗi được test chủ động giả lập
để xác minh cơ chế best-effort và metric; không phải lỗi của lượt chạy.

Xác minh thủ công hai Backend instance và Redis restart đã PASS tại
`docs/runbooks/P2-T18-step3-multi-instance-verification.md`.
