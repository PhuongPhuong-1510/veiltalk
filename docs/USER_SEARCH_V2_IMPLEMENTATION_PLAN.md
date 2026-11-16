# VeilTalk User Search V2 — Kế hoạch thiết kế và triển khai

> Trạng thái: **DRAFT FOR REVIEW — chưa triển khai**  
> Ngày lập: 2026-11-09  
> Phạm vi: tìm kiếm **người dùng**; không bao gồm feed, bài viết, community hoặc matching theo sở thích.

## 1. Mục tiêu

Nâng cấp tìm kiếm người dùng từ exact-email hiện tại thành một hệ thống có ba trường danh tính rõ ràng:

- `email`: định danh riêng tư cho đăng nhập/khôi phục và exact lookup có opt-in;
- `username`: handle công khai, duy nhất, ổn định và là cách tìm người chính;
- `display_name`: tên Unicode có thể trùng, chỉ dùng để hiển thị và **không dùng làm khóa tìm kiếm**.

Thiết kế phải đạt đồng thời:

1. Không làm mất hành vi anti-enumeration của exact-email hiện tại.
2. Không âm thầm mở rộng quyền discoverability của người dùng cũ.
3. Có query/index rõ ràng, không dựa vào full table scan khi dữ liệu tăng.
4. Có thứ tự kết quả xác định, giới hạn kết quả và rate limit phù hợp autocomplete.
5. Có migration/rollout tương thích ngược, không sửa migration Flyway đã chạy.
6. Có seam để sau này thêm block, trust/safety hoặc đổi search backend mà không đổi lại toàn bộ contract.

## 2. Hiện trạng đã xác minh

### 2.1. Database

Bảng `users` hiện có `email`, `display_name`, `avatar_url`, `is_discoverable`, `deleted_at` nhưng chưa có `username`.

Các index liên quan:

- `idx_users_email`: unique partial index trên `email` khi `deleted_at IS NULL`;
- `idx_users_discoverable_email`: partial index trên `email` khi còn hoạt động và `is_discoverable = TRUE`;
- `idx_users_deleted_at`: index phục vụ soft-deleted rows.

`display_name` chưa có index. `is_discoverable` hiện có nghĩa cụ thể là cho phép tìm qua email.

### 2.2. Backend

- `POST /users/search` chỉ nhận `{ "email": "..." }`.
- Query là exact equality theo email, chỉ với user đã bật `is_discoverable` và chưa soft-delete.
- Response chỉ là một kết quả `{found,user}` và không trả email.
- Rate limit Redis fixed-window: 10 request/phút/tài khoản; 429 có `Retry-After`.
- `INCR` và `EXPIRE` đang là hai thao tác riêng, chưa atomic.

### 2.3. Frontend

- Chỉ có một form submit email chính xác.
- Chưa auto-focus, chưa có history 5 query, chưa đọc `Retry-After` để countdown.
- API client hiện làm mất header `Retry-After` khi chuyển response lỗi thành `ApiError`.
- Chưa có debounce, request cancellation, result list hoặc keyboard navigation.

## 3. Quyết định sản phẩm đề xuất để review

### 3.1. Ba loại định danh

| Trường | Duy nhất | Công khai | Tìm kiếm | Quy tắc |
|---|---:|---:|---|---|
| `email` | Có | Không | Exact, opt-in | Dùng cùng canonicalization với đăng nhập |
| `username` | Có | Có khi username searchable | Exact + prefix | ASCII lowercase, 3–30 ký tự |
| `display_name` | Không | Hiển thị trong result | Không tìm kiếm | Unicode, 1–100 ký tự |

### 3.2. Username

Quy tắc đề xuất:

- dài 3–30 ký tự;
- chỉ gồm `a-z`, `0-9`, `.` và `_`;
- ký tự đầu/cuối phải là chữ hoặc số;
- không cho hai separator liên tiếp (`..`, `__`, `._`, `_.`);
- backend trim và lowercase trước validation/lưu;
- không dùng username thuộc reserved list như `admin`, `support`, `system`, `veiltalk` và các biến thể chống giả mạo;
- username không đổi trong phiên bản đầu tiên; chính sách đổi/reuse sẽ là một feature riêng để tránh impersonation và URL takeover.

Không tự sinh username công khai từ phần trước `@` của email.

### 3.3. Discoverability

Không đổi ngầm ý nghĩa của `is_discoverable` vì người dùng cũ chỉ đồng ý “tìm qua email”.

Đề xuất:

- giữ `is_discoverable` trong giai đoạn tương thích, coi nó là `discoverable_by_email`;
- thêm `is_username_searchable BOOLEAN NOT NULL DEFAULT FALSE` cho tìm username;
- người dùng cũ có thể tiếp tục có `username = NULL`, không bị ép qua màn hình chọn username và không xuất hiện trong username search;
- tài khoản mới bắt buộc nhập username trực tiếp trong form đăng ký và `POST /auth/register`;
- việc cập nhật username cho tài khoản cũ nằm ngoài phạm vi V2 và sẽ được thực hiện riêng sau này;
- có username không đồng nghĩa tự động searchable; `is_username_searchable` vẫn mặc định false cho tới khi người dùng đồng ý;
- email search và username search là hai consent độc lập.

Sau rollout có thể đổi tên `is_discoverable` thành `discoverable_by_email` trong một migration riêng; không gộp rename vào migration username để rollback/diagnose dễ hơn.

### 3.4. Phạm vi matching

- Email: exact only, tuyệt đối không fuzzy.
- Username: exact và prefix; không typo-fuzzy trong V2.
- Display name: không tham gia điều kiện hoặc thứ tự tìm kiếm; chỉ được trả về để người dùng nhận diện kết quả.

Ngưỡng nhập tối thiểu là **3 ký tự** sau khi bỏ `@`, trùng với độ dài username tối thiểu. Query tối đa 30 ký tự sau trim/lowercase.

### 3.5. Giới hạn kết quả

- Trả tối đa 10 user cho một query trong V2.
- Không phân trang/infinite scroll ở bản đầu để hạn chế account enumeration.
- Nếu prefix khớp hơn 10 username, người tìm phải nhập cụ thể hơn.
- Không dùng `created_at`, độ mới tài khoản hay UUID như tín hiệu “độ phù hợp”; các trường này chỉ được dùng làm tie-break ổn định nếu cần.

Đây là giới hạn privacy có chủ đích, không phải giới hạn kỹ thuật. Nếu sau này cần pagination, phải review lại threat model trước khi thêm cursor.

## 4. Thiết kế dữ liệu

### 4.1. Migration theo expand/contract

Không sửa `V1__initial_schema.sql`–`V4__...`. Tạo migration mới theo thứ tự thực tế kế tiếp.

Migration expand đề xuất:

```sql
ALTER TABLE users
    ADD COLUMN username VARCHAR(30),
    ADD COLUMN is_username_searchable BOOLEAN NOT NULL DEFAULT FALSE;
```

Trong expand phase, `username` cho phép `NULL` để deployment không khóa tài khoản cũ. Không thêm cột normalized display name và không cần extension tìm kiếm mờ.

### 4.2. Constraint username

Database là lớp bảo vệ cuối cùng, không chỉ dựa vào frontend:

```sql
ALTER TABLE users ADD CONSTRAINT chk_users_username_format CHECK (
    username IS NULL OR (
        char_length(username) BETWEEN 3 AND 30
        AND username ~ '^[a-z0-9][a-z0-9._]*[a-z0-9]$'
        AND username !~ '(\.\.|__|\._|_\.)'
    )
);
```

Reserved words được kiểm tra ở service và test bằng một danh sách version-controlled. Unique constraint/index vẫn là authority cuối cho race condition.

### 4.3. Index đề xuất

#### Bắt buộc khi thêm username

```sql
CREATE UNIQUE INDEX idx_users_username
ON users (username)
WHERE username IS NOT NULL;
```

Index này cố ý bao gồm cả soft-deleted rows còn giữ trong DB, để username không bị chiếm lại trong cửa sổ retention. Khi row user bị hard-delete sau retention, username được giải phóng và có thể đăng ký lại; V2 không giữ username vĩnh viễn sau khi dữ liệu tài khoản đã bị xóa thật.

#### Prefix username cho username search

```sql
CREATE INDEX idx_users_searchable_username_prefix
ON users (username varchar_pattern_ops)
WHERE deleted_at IS NULL
  AND is_username_searchable = TRUE
  AND username IS NOT NULL;
```

Mọi prefix pattern phải escape `_`, `%` và chính escape character rồi dùng `LIKE ... ESCAPE '\\'`. Test bắt buộc xác nhận query `minh_` không khớp `minh1`.

Không thêm bất kỳ index tìm kiếm nào lên `display_name`, vì V2 không cho tìm theo tên hiển thị. Index thừa chỉ tăng dung lượng và write amplification.

### 4.4. Tài khoản cũ

Không backfill username từ email hoặc display name. User cũ vẫn hoạt động với `username = NULL`, không bị ép chọn username và chưa tham gia username search. Việc cập nhật thủ công hoặc xây flow cho user cũ là công việc ngoài phạm vi V2.

Đây là giới hạn sản phẩm được chấp nhận theo quyết định chủ dự án, không phải luồng còn thiếu trong implementation V2.

Với bảng lớn ở production, index prefix có thể tạo bằng `CREATE INDEX CONCURRENTLY` trong Flyway migration không chạy transaction. Trước production phải xác minh quyền DB và quy trình migration; môi trường hiện tại có thể dùng index thường nếu dữ liệu nhỏ.

## 5. API contract

### 5.1. Giữ exact-email endpoint hiện tại

Giữ `POST /users/search` trong V2 để không phá frontend/test hiện tại:

```json
{ "email": "friend@example.com" }
```

Response tiếp tục là:

```json
{ "found": true, "user": { "id": "uuid", "display_name": "Friend" } }
```

hoặc:

```json
{ "found": false }
```

Không phân biệt email không tồn tại với chưa opt-in. Không trả email hoặc username; quyền tìm qua email không làm lộ handle khi target tắt username search.

### 5.2. Thêm username search endpoint riêng

Đề xuất:

```http
POST /users/search/usernames
Content-Type: application/json
Authorization: Bearer ...
```

Request:

```json
{
  "query": "minh.ng",
  "limit": 10
}
```

Validation:

- bỏ `@`, trim và lowercase; query sau chuẩn hóa dài 3–30 ký tự;
- query chỉ được chứa tập ký tự hợp lệ của username;
- `limit` mặc định 10, chỉ cho 1–10;
- không nhận cursor trong V2;
- reject unknown search mode thay vì client điều khiển raw SQL strategy.
- escape `%`, `_` và escape character trước mọi `LIKE`; không nối raw query vào SQL.

Response:

```json
{
  "data": [
    {
      "id": "uuid",
      "username": "minh.nguyen",
      "display_name": "Nguyễn Hoàng Minh",
      "avatar_url": null
    }
  ],
  "meta": {
    "limit": 10,
    "truncated": false
  }
}
```

`truncated` chỉ cho biết còn kết quả bị giới hạn, không cung cấp tổng số (`total_count`) để tránh enumeration và tránh query `COUNT(*)` tốn chi phí.

### 5.3. Đăng ký tài khoản mới với username

Mở rộng request hiện tại:

```http
POST /auth/register
{
  "email": "user@example.com",
  "password": "...",
  "display_name": "Nguyễn Hoàng Minh",
  "username": "minh.nguyen",
  "username_searchable": false
}
```

- normalize, validate format và reserved words ở backend;
- tạo user và username trong cùng transaction đăng ký;
- unique index xử lý race, map duplicate thành `409 USERNAME_TAKEN`;
- tài khoản mới thiếu username hoặc username sai định dạng trả `400 VALIDATION_ERROR`;
- `username_searchable` là lựa chọn rõ ràng trong form, mặc định false nếu không gửi;
- endpoint kiểm tra availability, nếu thêm để hỗ trợ form, chỉ là UX hint và không bao giờ thay unique constraint;
- V2 không cung cấp endpoint claim/đổi username cho tài khoản cũ.

`GET /users/me`, register/login response và frontend auth state cần thêm `username: string | null`: luôn có giá trị với tài khoản mới, có thể `null` với tài khoản cũ.

### 5.4. Settings

Giữ `discoverable` hiện tại cho email trong compatibility window. Thêm field rõ nghĩa:

```json
{
  "discoverable": false,
  "username_searchable": false,
  "email_notifications": true,
  "theme": "system"
}
```

Không cho bật `username_searchable=true` khi chưa có username; trả `409 USERNAME_REQUIRED` hoặc validation error có field rõ ràng.

## 6. Query và thứ tự kết quả

### 6.1. Eligibility filter bắt buộc

Mọi username query phải áp dụng:

- `deleted_at IS NULL`;
- `is_username_searchable = TRUE`;
- `username IS NOT NULL`;
- loại requester khỏi kết quả;
- seam để sau này loại quan hệ block hai chiều mà không đổi API.

### 6.2. Thứ tự cố định

Thứ tự đề xuất:

1. username exact;
2. username prefix;

Trong cùng bucket, sắp xếp `username` rồi `id` tăng dần để response deterministic.

Không xếp hạng bằng độ mới tài khoản, email, trạng thái online hoặc thông tin riêng tư.

Không hard-code một phương án query trước benchmark. Hai candidate bắt buộc so sánh trên dataset đại diện:

1. một query `LIKE escapedPrefix%` với exact-first ordering;
2. exact lookup giới hạn 1 kết hợp prefix lookup loại exact và giới hạn phần còn lại.

Chọn phương án đạt budget với ít DB round-trip/resource hơn và ghi `EXPLAIN (ANALYZE, BUFFERS)` vào performance report. Candidate một-query:

```sql
SELECT id, username, display_name, avatar_url,
       CASE
         WHEN username = :usernameQuery THEN 1
         WHEN username LIKE :prefix THEN 2
       END AS rank_bucket
FROM users
WHERE deleted_at IS NULL
  AND is_username_searchable = TRUE
  AND username IS NOT NULL
  AND id <> :requesterId
  AND username LIKE :escapedPrefix ESCAPE '\\'
ORDER BY rank_bucket,
         username,
         id
LIMIT :limitPlusOne;
```

Query lấy `limit + 1` row để tính `truncated` mà không chạy `COUNT(*)`, sau đó bỏ row thứ 11 khỏi response.

## 7. Rate limit, cache và tải hệ thống

### 7.1. Hai limiter độc lập

- Exact email: giữ 10 request/phút/user vì đây là lookup nhạy cảm.
- Username autocomplete: đề xuất token bucket 30 request/phút/user, burst tối đa 10.

Username-search limiter phải atomic bằng Redis Lua script hoặc primitive tương đương; không lặp lại cặp `INCR`/`EXPIRE` rời hiện tại. Rate limit theo user là lớp chính; có thể thêm defense theo IP ở gateway sau khi có dữ liệu vận hành.

429 luôn trả:

- `Retry-After` dạng số giây;
- error code ổn định;
- error envelope JSON hợp lệ thay vì body rỗng, kể cả exact-email endpoint hiện tại;
- không chạy DB query sau khi limiter từ chối.

### 7.2. Client-side load control

- debounce 350 ms cho username autocomplete;
- không gọi API dưới 3 ký tự sau khi bỏ `@`;
- `AbortController` hủy request cũ;
- sequence/request-id guard để response cũ không ghi đè response mới;
- không cache username-search results ở frontend trong V2; debounce và hủy request cũ là cơ chế giảm tải;
- history chỉ lưu query string, tối đa 5 mục, namespace theo user và xóa khi logout/xóa tài khoản.

Email lookup chỉ gọi khi submit, không autocomplete theo từng phím.

### 7.3. Server-side cache

Không thêm result cache server trong V2. Indexed PostgreSQL query là source of truth và kết quả phụ thuộc username visibility/soft-delete. Chỉ thêm cache khi profiling chứng minh DB là bottleneck; khi đó phải có invalidation cho username, display name, visibility, avatar và delete.

## 8. Frontend UX và state machine

### 8.1. Một ô tìm kiếm

Placeholder:

> Tìm theo @username hoặc email

Phân luồng:

- valid email + submit: exact-email endpoint;
- bắt đầu bằng `@`: bỏ `@` khi gửi username query;
- text thường từ 3 ký tự: coi là username prefix và autocomplete;
- input chứa `@` ở giữa nhưng sai định dạng email: hiển thị lỗi kiểm tra email, không chuyển sang tìm username.

### 8.2. Trạng thái UI

Phải có state rõ ràng:

- idle/history;
- typing/debouncing;
- loading;
- results;
- empty;
- invalid input;
- network/server error;
- rate-limited với countdown;
- starting conversation.

Không dùng một biến `busy` chung cho search và create-conversation vì hai thao tác có vòng đời khác nhau.

### 8.3. Result row

Mỗi row chỉ hiển thị:

- avatar hoặc generic mask fallback;
- `display_name`;
- `@username`;
- nút “Nhắn tin”.

Không hiển thị email, UUID, trạng thái online hoặc tổng số tài khoản khớp.

### 8.4. Countdown và accessibility

- mở rộng `ApiError` hoặc response metadata để giữ `Retry-After`;
- countdown dựa trên deadline monotonic/client time, không giảm bằng cách cộng trừ state dễ drift;
- disable request mới tới khi hết hạn nhưng vẫn cho sửa input;
- progress indicator có accessible text, không chỉ dùng animation;
- input dùng combobox/listbox semantics, hỗ trợ Arrow Up/Down, Enter, Escape;
- auto-focus theo roadmap; trên mobile cần test tránh che nội dung bởi bàn phím;
- mọi vùng bấm tối thiểu 44px và có visible focus.

## 9. Backend structure đề xuất

Tách trách nhiệm để tránh `UserSearchService` trở thành một service lớn:

- `UsernamePolicy`: normalize/validate/reserved words;
- `ExactEmailSearchService`: giữ hành vi FR-22 hiện tại;
- `UsernameSearchService`: eligibility, exact/prefix ordering và result mapping;
- `UsernameSearchRepository`: query exact/prefix đã kiểm soát, không ghép SQL từ input;
- `UserSearchRateLimiter`: exact-email limiter;
- `UsernameSearchRateLimiter`: autocomplete limiter atomic;
- `UserSearchEligibilityPolicy`: seam cho self/block/trust-safety filters;
- DTO riêng cho exact-email và username-search results.

Đặt query trong repository chuyên biệt và có integration test/query-plan test; không ghép wildcard hoặc SQL trực tiếp từ input.

## 10. Bảo mật và privacy threat model

Phải kiểm thử các tình huống:

1. Email tồn tại nhưng không opt-in và email không tồn tại trả body/status giống nhau.
2. User không bật username search không xuất hiện ở username exact hoặc prefix.
3. Soft-deleted user không xuất hiện.
4. Requester không thấy chính mình trong result list.
5. Không có endpoint trả `total_count` hoặc dump tất cả profile.
6. Rate limit không dùng chung giữa hai tài khoản.
7. Burst qua ranh giới cửa sổ không né được username-search limiter.
8. Username reserved/case variant/concurrent registration không vượt unique index.
9. Query chứa `%`, `_`, quote, control character hoặc Unicode lạ không trở thành SQL wildcard/injection ngoài ý muốn.
10. Log không ghi raw email/search query ở INFO; telemetry chỉ ghi length/type/latency/result-count hoặc hash có salt nếu thực sự cần correlation.
11. Sau khi tắt username search, request mới không còn trả user; frontend không dùng result cache cũ.
12. Hook block hai chiều được áp dụng trước khi trả kết quả khi feature block được triển khai.

## 11. Test plan

### 11.1. Unit tests

- username normalize/format/reserved words;
- query classifier frontend;
- debounce/cancellation/stale response guard;
- countdown `Retry-After`;
- exact-before-prefix ordering nếu có logic ngoài SQL.

### 11.2. Migration/schema tests

- cột/default/nullability đúng theo từng phase;
- duplicate username bị chặn kể cả request concurrent;
- soft-deleted username chưa được claim lại khi row còn tồn tại;
- partial indexes có predicate đúng;
- Flyway migrate từ V1 và từ schema hiện tại đều thành công;
- Hibernate `ddl-auto=validate` pass.

### 11.3. Integration/API tests

- giữ toàn bộ TC-16–TC-20 cũ;
- username exact/prefix;
- prefix chứa `_` được escape: `minh_` không khớp `minh1`; kiểm thử tương tự cho `%` và escape character ở repository boundary;
- query dưới 3 ký tự bị từ chối/không gọi API;
- deterministic top 10 và `truncated` bằng `limit + 1`;
- không trả email/password/settings;
- visibility, self, soft-delete;
- 400 validation, 401 auth, 409 username conflict, 429 và `Retry-After`;
- bật username search khi chưa có username bị từ chối;

### 11.4. Frontend tests

- exact email gọi endpoint cũ đúng một lần khi submit;
- username autocomplete debounce đúng;
- request cũ bị abort hoặc ignored;
- keyboard navigation và ARIA roles;
- history tối đa 5, dedupe và clear;
- countdown khóa request nhưng không khóa chỉnh input;
- result mở/tạo conversation đúng user ID;
- empty/error/rate-limit không làm mất query đang nhập.

### 11.5. Performance tests và gate

Tạo dataset đại diện ít nhất 100k users, gồm:

- username có common prefixes;
- username searchable/non-searchable;
- soft-deleted rows;

Gate đề xuất để review/chốt theo hạ tầng CI:

- indexed DB search p95 ≤ 50 ms trên dataset 100k sau warm-up;
- API username search p95 ≤ 150 ms nội bộ, không tính Internet;
- query đạt budget thời gian/tài nguyên trên dữ liệu đại diện; không fail chỉ vì planner chọn `Seq Scan` trên bảng nhỏ hoặc selectivity thấp, nhưng full scan gây suy giảm theo tăng trưởng là release blocker;
- response tối đa 10 row, không `COUNT(*)`;
- tải autocomplete mục tiêu ban đầu phải được đo với k6/JMeter và nêu rõ concurrency, không chỉ báo một latency đơn lẻ;
- so sánh write cost trước/sau index cho register và toggle username visibility.

Các con số trên là performance budget đề xuất, không tuyên bố đã đạt trước khi benchmark.

## 12. Observability

Metric tối thiểu, không chứa PII:

- `user_search_requests_total{type,outcome}`;
- `user_search_duration_seconds{type}`;
- `user_search_result_count{type}` dưới dạng histogram;
- `user_search_rate_limited_total{type}`;
- `user_search_db_duration_seconds{strategy}`;
- `username_registration_total{outcome}`;

Theo dõi p50/p95/p99, 400/429, empty-result rate và tỷ lệ DB timeout. Alert khi p95 vượt budget liên tục hoặc 429 tăng bất thường. Không gắn raw query/email/username vào label vì cardinality và PII.

## 13. Trình tự triển khai

### Phase 0 — Review và design lock

- Review tài liệu này với product, backend, frontend, security/privacy.
- Chốt các quyết định ở mục 14.
- Cập nhật FR-22, API, database, UI/UX, test plan và roadmap trước khi code.

**Exit gate:** không còn câu hỏi blocking về consent, username lifecycle, API contract và thứ tự kết quả.

### Phase 1 — Database expand + domain primitives

- Thêm migration nullable/default-safe.
- Thêm username policy.
- Cập nhật entity nhưng vẫn tương thích user cũ.
- Unit/migration tests.

**Exit gate:** migration sạch, ứng dụng cũ mới không mất login/profile, `ddl-auto=validate` pass.

### Phase 2 — Username trong đăng ký mới

- Thêm `username` bắt buộc vào `POST /auth/register` và form đăng ký.
- Thêm checkbox “Cho phép người khác tìm thấy tôi bằng @username”, mặc định tắt, gửi `username_searchable` trong cùng request.
- Cập nhật profile/auth DTO có `username` nullable để tương thích account cũ.
- Không thêm màn hình ép chọn username hoặc endpoint claim username cho account cũ.
- Xử lý unique race bằng DB constraint.

**Exit gate:** mọi account mới có username; account cũ `username = NULL` vẫn hoạt động; concurrency test pass.

### Phase 3 — Username visibility

- Thêm setting `username_searchable` và UI consent rõ ràng.
- Không cho bật nếu chưa có username.

**Exit gate:** tài khoản cũ không bị mở visibility ngoài ý muốn; toggle có hiệu lực tức thời.

### Phase 4 — Backend username search

- Thêm endpoint/repository và exact-before-prefix ordering.
- Thêm atomic username-search limiter.
- Giữ nguyên exact-email endpoint/tests.
- Thêm integration, security và query-plan tests.

**Exit gate:** functional/security tests pass; EXPLAIN dùng index trên dataset gate.

### Phase 5 — Frontend search V2

- Một input, classifier email/username.
- Debounce, abort và stale-response guard; không cache result list.
- Result list, history 5 query, auto-focus, keyboard accessibility.
- Countdown từ `Retry-After`.
- Tách search state khỏi create-conversation state.

**Exit gate:** component/integration/e2e tests pass trên desktop và mobile viewport.

### Phase 6 — Performance qualification

- Seed dataset 100k và benchmark read/write.
- Chạy kịch bản autocomplete burst, exact email và username registration race.
- Điều chỉnh threshold/index dựa trên EXPLAIN/metric, không dựa vào phỏng đoán.
- Ghi report kết quả và hardware/config benchmark.

**Exit gate:** đạt budget đã chốt hoặc có waiver/documented trade-off.

### Phase 7 — Rollout có kiểm soát

- Bật feature flag cho internal/test users.
- Sau đó rollout theo phần trăm tài khoản/môi trường.
- Theo dõi latency, DB CPU/IO, 429, empty-result và error.
- Có kill switch tắt username search nhưng exact-email vẫn hoạt động.

**Exit gate:** metric ổn định qua thời gian quan sát đã chốt.

### Phase 8 — Contract cleanup

- Tiếp tục để schema cho phép `username = NULL` vì account cũ chưa được migrate trong V2.
- Chỉ cân nhắc `username NOT NULL` trong một dự án migration legacy riêng sau khi toàn bộ account cũ đã được cập nhật và kiểm chứng.
- Cân nhắc rename `is_discoverable` → `discoverable_by_email` trong migration/API version riêng.
- Xóa compatibility code chỉ sau telemetry chứng minh không còn client cũ.

## 14. Các quyết định AI reviewer phải phản biện/chốt

1. **Visibility mặc định:** form đăng ký có checkbox consent `username_searchable`, mặc định false; người dùng vẫn có thể đổi trong Settings sau đăng ký.
2. **Username lifecycle:** V2 immutable có chấp nhận được không? Nếu cho đổi, cần cooldown, redirect và reservation table trước khi code.
3. **Username reuse:** V2 giữ username trong suốt soft-delete/retention và cho phép tái sử dụng sau hard-delete; nếu muốn reservation dài hơn phải bổ sung bảng/chính sách riêng.
4. **Email canonicalization:** hệ thống hiện chưa chứng minh đã canonicalize thống nhất. Cần audit collision trước khi đổi unique index hoặc lowercase dữ liệu; không sửa riêng trong search.
5. **Top-10 không pagination:** xác nhận đây là privacy/product limit có chủ đích.
6. **Prefix tối thiểu 3 ký tự:** xác nhận cân bằng giữa UX, tải hệ thống và enumeration risk.
7. **Performance budget:** xác nhận dataset, hardware, concurrency và SLO trước khi dùng làm release gate.

## 15. Ngoài phạm vi V2

- Search bài viết, topic, community hoặc semantic/vector search.
- Suggested users/recommendation graph.
- Tìm theo `display_name`, chuẩn hóa không dấu hoặc fuzzy match tên hiển thị.
- Tìm theo vị trí, tuổi, giới tính hoặc trạng thái online.
- Fuzzy email.
- Username change, redirect và marketplace/reuse policy.
- Public follower graph.
- Elasticsearch/OpenSearch; chỉ cân nhắc khi PostgreSQL đã được đo là bottleneck hoặc phạm vi search được mở rộng ngoài username prefix.

## 16. Definition of Done tổng

User Search V2 chỉ được coi là hoàn thành khi:

- schema, migration, consent và API docs đồng bộ;
- exact-email anti-enumeration cũ không regression;
- username unique/race-safe và không lộ email;
- username search chỉ thấy user đã opt-in;
- thứ tự exact-before-prefix deterministic, tối đa 10, không full count;
- rate limiter atomic, countdown hoạt động đúng;
- frontend có debounce/cancel/accessibility/history;
- security, integration, e2e và migration tests pass;
- performance report có dataset/config/EXPLAIN và đạt gate đã chốt;
- observability không ghi PII và có kill switch/rollout plan;
- mọi thay đổi hành vi đã được cập nhật trong SRS, Database Design, API, UI/UX, Test Plan, Roadmap và Current Status.

## 17. Prompt gợi ý cho AI reviewer

Có thể gửi nguyên tài liệu này cùng yêu cầu:

> Hãy review kế hoạch User Search V2 như một principal backend engineer kiêm security/privacy reviewer. Không viết code. Hãy tìm mâu thuẫn nghiệp vụ, lỗ hổng enumeration/privacy, migration không an toàn, index không phục vụ query, thứ tự kết quả thiếu ổn định, rate-limit có thể bị né, API khó mở rộng và performance gate không đo được. Với mỗi vấn đề, ghi severity, bằng chứng theo mục, hậu quả, và đề xuất sửa cụ thể. Sau đó kết luận APPROVE, APPROVE WITH CHANGES hoặc REJECT, kèm danh sách blocking changes tối thiểu trước khi code.
