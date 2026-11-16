# T07 — Quyết định contract và các điểm còn cần instrumentation

**Không sửa backend để ép test PASS. Không đổi oracle khi gặp FAIL.** Các quyết định dưới đây
được chủ dự án xác nhận ngày 28/10/2026 sau khi đối chiếu source và tài liệu hiện hành.

## Quyết định đã khóa

| ID | Contract đã chốt |
|---|---|
| T07-AUTH-004 | Refresh token reusable đến khi hết hạn hoặc bị thu hồi. Hai refresh đồng thời có thể cùng thành công, nhưng không được tạo thêm refresh row hay token trùng nhau. Rotation là thay đổi API riêng, ngoài T07 hiện tại. |
| T07-AUTH-005 | Logout có tính tuyến tính tại response `204`: refresh hoàn tất trước mốc revoke có thể thành công; sau khi logout hoàn tất, mọi access token sinh từ refresh token của phiên đó phải bị từ chối. |
| T07-CALL-003/004 | Session được chiếm nguyên tử: offer đầu thắng; offer khác nhận `TARGET_BUSY`; tái sử dụng `call_id` nhận `INVALID_CALL_SESSION`. Glare A↔B chỉ có một phiên thắng. |
| T07-CALL-005 | `CALL_END` đầu tiên kết thúc phiên; lần đồng thời/đến sau nhận `INVALID_CALL_SESSION`. Không được kết thúc nhầm phiên mới. |
| T07-CALL-006/007 | Pending timeout sau 30 giây, sweep tối đa 5 giây; mất socket cuối của một user kết thúc phiên và báo `peer_disconnected`. |
| T07-CALL-013 | Cho phép nhiều signaling socket trên một user. Event trạng thái cuộc gọi phải được đồng bộ tới các socket liên quan; hành động hợp lệ đầu tiên quyết định state. |
| T07-VID-001/002 | Chỉ một thao tác thắng. Finalize thắng trả `202`, abort thắng trả `204`; request thua trả `409 CONFLICT`. PostgreSQL, Redis và MinIO phải có một outcome nhất quán. |
| T07-VID-003 | `DELETE /videos/{id}` được phép ở recording/processing/ready/failed. Cleanup phải phù hợp state: abort multipart/xóa Redis cho recording, không hồi sinh processing đã xóa, durable object cleanup cho processing/ready. |
| T07-VID-005 | Chỉ cấp part kế tiếp sau khi part trước đã PUT và ETag thực được xác minh; việc chỉ cấp presigned URL chưa được coi là upload xong. |
| T07-VID-015 | Khi dependency khỏe, processing video mất webhook phải reconcile thành ready/failed trong tối đa 15 phút (timeout 10 phút + chu kỳ quét 5 phút). E2E được phép nén thời gian bằng config. |
| T07-LOCK-004 | Renew lỗi tạm thời chưa lập tức mất lock. Khi lease hết hoặc ownership đã mất, holder cũ phải fail-closed trước side effect tiếp theo; cần ownership check/fencing để holder cũ không commit sau holder mới. |
| T07-MULTI-005 | MVP chỉ cam kết một Node signaling instance. Multi-node signaling là `KNOWN_GAP` cho đến khi có shared call state hoặc thiết kế routing/failover rõ ràng. |

## Các mâu thuẫn/chỗ thiếu hợp đồng quan trọng

| ID | Phát hiện từ source/spec | Cần chủ dự án quyết định/xác minh |
|---|---|---|
| T07-TX-004 | `MessageService` phát Redis qua `afterCommit`; khi Redis publish thất bại có thể đã commit PostgreSQL, HTTP vẫn lỗi. | Có chấp nhận HTTP lỗi dù DB commit và client phải retry cùng UUID không? |
| T07-PUB-001/002 | Redis Pub/Sub là non-durable. | **Không được** yêu cầu tự replay event đã mất; oracle đúng là DB/history bền vững, reconnect/sync có policy. |
| T07-ENV-004 | `SIGKILL` bỏ qua JS `finally`; teardown trực tiếp không thể tự chạy lúc process chết. | Dùng janitor riêng kiểm tra container label theo run ID; không giả vờ cleanup trong cùng process. |

## Mismatches trong tài liệu lịch sử (không dùng để sửa code sản phẩm)

- T07 spec ghi E09/E10 lịch sử **FAIL**, trong khi các báo cáo T05 gần đây trong `scripts.zip` đã có các testcase tương ứng PASS. Phải dùng test chạy tại phiên bản hiện tại; không được tự tuyên bố regression vẫn FAIL hoặc đã giải quyết vĩnh viễn.
- T07 spec ban đầu khảo sát 137 `.java` trước đó; ZIP backend đã gửi trong hội thoại này có **146 file `.java`**. Cần khóa hash/commit trên runner thật.
- `T07-VID-003`: Java hiện tại soft-delete mọi state nhưng chưa chứng minh cleanup Redis/MinIO theo contract mới khóa; test phải kiểm tra cả ba lớp trạng thái.

## Các loại instrumentation cần thiết (chưa cài vào sản phẩm)

1. Test-only gates theo `run_id` và correlation ID trước DB commit, sau commit trước Redis publish; cực hạn TTL để gate tự mở và fail-safe khi runner crash.
2. Proxy/fault layer cho Redis Pub/Sub riêng kết nối key operations, MinIO complete và PostgreSQL; phải đặt được điểm lỗi đúng request/test ID.
3. Phần quan sát read-only của WebSocket registry, Redis lock lease, cleanup job queue, signaling active/pending Map ở chế độ test.
4. Thứ tự timeline có monotonic timestamp, barrier ACK từ backend, mỗi case có seed và event evidence.
5. Multi-instance (nếu yêu cầu) dựng sau khi xác định Node signaling state sharing/lb behavior; không gộp vào single-instance report.

> Các probe chỉ kiểm tra oracle đã đối chiếu được; client start gate không được trình bày như server transaction barrier.
