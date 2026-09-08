# P4-T10 — Phase 3B.4: Wrist Evidence & Partial-arm Reconstruction

> Trạng thái: **IMPLEMENTED — AUTOMATED GATE PASS; MANUAL WEBCAM RETEST PENDING**
>
> Automated gate ngày 2026-09-09 sau corrective spatial + absolute-palm patch và DEV avatar selector: `50 files / 600 tests PASS`, lint PASS, TypeScript + Vite
> production build PASS. Không thêm thư viện, không đổi `AvatarPosePacketV1`, không gửi raw
> landmark hay ảnh ra khỏi trình duyệt.

## 1. Mục tiêu

Giữ cánh tay ổn định khi Pose wrist/elbow bị che nhưng Hand Landmarker vẫn thấy bàn tay. Pose
world và Hand world không được trộn trực tiếp vì khác origin. Hand chỉ cung cấp wrist image-space;
motion layer dựng candidate 3D bằng hình học xương và lịch sử đã quan sát.

## 2. Pipeline hiện hành

```text
Pose wrist + Hand wrist image
        ↓
image-space matching (Pose tốt hoặc recent continuity)
        ↓
wristEvidence: freshness + timestamp + sample-only confirmation
        ↓
Pose wrist tốt ───────────────→ dùng Pose world
Pose wrist mất + Hand tốt ────→ image-to-world local scale
                                  ↓
                         sphere reconstruction + depth prior
                                  ↓
                         two-bone IK nếu elbow cũng mất
        ↓
analytical elbow candidates + Hand palm-forward soft scoring
        ↓
parent-local/rest-relative delta → temporal → VRM
```

Raw tracking frame không bị mutate. Processor chỉ tạo shallow copy hai mảng landmark khi
reconstruction thành công. Mọi reject giữ nguyên fallback hold/return trước Phase 3B.4.

## 3. Contract toán học

Scale orthographic cục bộ lấy từ bề rộng hai vai trong cùng frame:

```text
s = shoulderWidthWorld / shoulderWidthImageAspectCorrected
```

Với anchor `A` (elbow hoặc shoulder), target image `(u,v)` và chiều dài mục tiêu `L`, phần x/y
world được dựng từ image delta nhân `s`. Depth có hai nghiệm:

```text
dz = ±sqrt(L² - dx² - dy²)
```

Chọn dấu gần hướng xương frame trước nhất. Thiếu depth prior, scale hỏng hoặc target vượt
`L + reachSlack` thì reject; không chọn dấu tùy ý và không kéo dài xương.

Khi elbow và wrist Pose cùng mất, endpoint shoulder→wrist dùng khoảng cách suy từ hai hướng
xương trước và chiều dài calibrated/prior; wrist được dựng trước, sau đó `inferElbow()` giải
two-bone IK.

## 4. Chọn nguồn và thời gian

- Nguồn: `pose-world`, `hand-image`, `held`, `unavailable`.
- Pose world hợp lệ luôn ưu tiên.
- Hand phải matched đúng side, còn mới, đồng bộ timestamp và tồn tại qua detector sample thật.
- Duplicate render frame không promote source.
- Chuyển trực tiếp Pose↔Hand kích hoạt reacquire blend; `held/unavailable` không ép upper arm
  blend khi upper geometry vẫn tốt.
- Pose cadence dùng EWMA. Grace hiệu dụng:

```text
grace = clamp(1.5 × estimatedPoseInterval, 80ms, 220ms)
```

Ở khoảng 11 FPS, grace xấp xỉ 136.5ms, đủ qua một sample interval thay vì rớt state ở 80ms.

## 5. Elbow candidate scoring

Hard rule “khuỷu luôn ở ngoài torso” bị bỏ. Hai pole candidate đối nhau được chấm O(1):

```text
score = priorDistance
      + historyDistance
      + palmForwardDistance
      + softOutsidePenalty
      + deepInsidePenalty
```

Cross-body gesture hơi đi vào trong có thể giữ continuity. Nghiệm xuyên sâu vẫn bị đổi nhánh.
Không có nonlinear optimizer hoặc vòng lặp per-frame.

`palmForwardDistance` chỉ có hiệu lực khi Hand đã match, sample còn mới và image palm basis có
`geometryQuality >= 0.35`. Với mỗi candidate elbow `E`, solver chiếu hướng cẳng tay `E→W` về mặt
phẳng ảnh rồi so với hướng Hand `wrist→middle-MCP`:

```text
D_palm = 1 - dot(normalize(projectImage(W - E)), palmForwardImage)
score += 1.1 × geometryQuality × D_palm
```

Đây là prior mềm, không phải ràng buộc cứng. Riêng elbow được Pose gắn là `observed` nhưng làm
cẳng tay ngược mạnh với palm-forward (`dot < -0.35`) sẽ bị hạ cấp và giải lại bằng two-bone IK.
Phép so chỉ dùng vector hướng; không trộn origin Pose-world với Hand-world.

### 5.1 Corrective spatial solver sau webcam 2026-09-07

Hai ảnh manual tiếp theo chứng minh palm-forward vẫn chưa đủ: thuật toán cũ chỉ chấm `prior` và
`-prior`, không biết vùng mặt thật và không biết tỷ lệ đầu/thân của avatar. Bản corrective hiện tại:

- quét đều 24 ứng viên trên **toàn đường tròn nghiệm** two-bone IK;
- dựng ellipse mặt local-only từ Face landmarks và nhận biết contact có chủ ý từ Hand landmarks;
- chấm face-clearance, side của tay so với mặt, head sphere và torso capsule của chính VRM;
- hạ cấp cả Pose elbow có visibility cao nếu khi ánh xạ lên avatar nó làm forearm xuyên head capsule;
- lấy rest palm normal từ finger rig của model để căn palm tuyệt đối; model thiếu rig vẫn dùng
  session-relative fallback cũ.

Mọi phép tính chạy trong browser. Face/Hand landmarks và collision geometry không đi vào
`AvatarPosePacketV1`, không thay đổi privacy/transport contract.

## 6. Automated evidence

- Exact antiparallel quaternion 180° finite và normalized.
- Basis non-finite/zero/collinear bị reject; basis hợp lệ là right-handed.
- Wrist Evidence ưu tiên Pose; Hand chỉ promote qua sample mới; duplicate không đổi source.
- EWMA grace đúng ở 11 FPS và có trần.
- Matching dùng recent continuity khi Pose wrist invalid, không dùng continuity hết hạn.
- Sphere reconstruction giữ chiều dài tuyệt đối, chọn đúng dấu depth từ prior, reject thiếu
  prior và reject target ngoài reach slack.
- Processor integration: Pose wrist mất + Hand wrist còn + elbow thấy → lower geometry vẫn có.
- Processor integration: Pose elbow và wrist cùng mất + Hand wrist còn → dựng wrist trước rồi
  infer elbow từ history.
- Pose wrist outlier low-confidence không thắng Hand continuity.
- Mild cross-body history thắng outside prior mềm; deep-inside fixture vẫn đổi nhánh.
- Palm-forward chọn lại đúng nhánh khi history/prior giữ khuỷu phía trên cổ tay.
- Elbow có visibility cao nhưng cẳng tay ngược palm-forward bị hạ cấp sang inference.
- Palm basis chất lượng thấp không được phép đổi nhánh khuỷu.
- Processor wiring vẫn sửa được nhánh khuỷu khi `Hand twist = OFF`.
- Face ellipse phân biệt tay tách khỏi mặt với contact có chủ ý.
- Full-circle search rời prior khi forearm cắt vùng mặt; không còn bị giới hạn ở hai pole đối nhau.
- Pose elbow nhìn thấy nhưng làm avatar xuyên head capsule bị hạ cấp và giải lại.
- Rig palm absolute giữ góc quan sát đầu tiên thay vì tự xóa nó thành session neutral.
- Toàn bộ regression Phase 3A/3B/3B.3 tiếp tục xanh.

## 7. Ma trận nghiệm thu webcam

Mở `/dev/avatar-renderer`, dùng model `full`, bật Filter/Constraints/Smoothing và quan sát panel
`Phase 3B partial-arm`.

| Case | Thao tác | Kỳ vọng diagnostic | Kỳ vọng avatar |
|---|---|---|---|
| W1 | Giữ tay rõ 2–3 giây | wrist `pose-world` | Bám như baseline |
| W2 | Che riêng vùng cổ tay của Pose nhưng để Hand còn thấy | wrist chuyển `hand-image`, reconstruct có số | Lower arm không rơi/giật; chiều dài không đổi thấy rõ |
| W3 | Đưa khuỷu ra ngoài khung, bàn tay vẫn rõ | elbow `inferred-*`; khi palm sửa nhánh có `palm chọn nhánh`; nếu Pose elbow giả bị bác bỏ có `Pose elbow bị Hand bác bỏ` | Tay tiếp tục giơ, khuỷu không flip lên trên vai/cổ tay |
| W4 | Che/mở nhanh cổ tay 10 lần | source không dao động mỗi render frame | Không snap khi Pose trở lại |
| W5 | Khoanh tay/chạm vai đối diện | không hard-flip chỉ vì đi vào trong | Cử chỉ cross-body giữ đúng phía gập |
| W6 | Đưa tay xuyên sâu qua vùng ngực theo ảnh | có thể có `deep-inside đổi nhánh` | Không quằn xuyên thân rõ rệt |
| W7 | Hạ FPS về khoảng 10–12 nếu tái hiện được | grace khoảng 120–180ms | Một sample hụt không làm tay rơi ngay |
| W8 | Tay xuất hiện lần đầu khi Pose wrist đã mất, chưa từng match | wrist chưa được trao quyền ngay | Hold/return an toàn, không gắn nhầm side |
| W9 | Giữ bàn tay cạnh mặt nhưng không chạm; quay lần lượt lòng/mu bàn tay về camera | `search 24`, face `clearance`, palm `rig-absolute`; có thể thấy face/collision đổi mặt phẳng | Forearm không cắt mặt avatar; bàn tay không lật ngược 180° |
| W10 | Chủ động chạm má/trán | face `contact` | Không bị solver đẩy tay ra xa mặt một cách giả tạo |

Chạy W2–W10 cho cả trái/phải và ít nhất ba model local. Nếu reconstruction reject, ghi lại chuỗi
`wrist source / reject reason / elbow source / pole source / FPS`; không chỉnh threshold chỉ từ
một ảnh đơn.

### Phát hiện từ manual gate ngày 2026-09-07

Ảnh webcam đầu tiên cho thấy tay avatar lật cả bend-plane dù tắt `Hand twist`; vì vậy W3 của bản
scoring chỉ có prior/history/outside được ghi nhận **FAIL**. Corrective patch hiện đã bổ sung đúng
thành phần palm-forward còn thiếu và qua automated gate, nhưng chưa được đổi thành manual PASS cho
tới khi tái kiểm tra cùng tư thế trên webcam.

Ảnh manual bổ sung cùng ngày tiếp tục FAIL: tay thật ở cạnh mặt nhưng forearm avatar cắt qua mặt và
palm vẫn có thể lật. Nguyên nhân được tách thành hai thiếu sót độc lập: solver chưa có face/rig collision
và Hand twist chỉ có neutral tương đối theo phiên. Corrective spatial + absolute-palm đã qua automated
gate nhưng W9/W10 vẫn **manual retest pending**; tài liệu không tuyên bố đã nghiệm thu.

## 8. Giới hạn còn lại

- Scale image→world hiện là orthographic cục bộ từ hai vai, chưa phải camera calibration đầy đủ.
- Không có depth prior thì Hand wrist image không đủ xác định nghiệm 3D; hệ thống chủ động reject.
- Đã có head sphere + torso/arm capsule suy từ normalized VRM rest pose; đây vẫn là collision proxy
  hình học thô, chưa phải mesh collision hay physics engine.
- Palm-forward là prior giải phẫu mềm; tư thế cố ý bẻ cổ tay cực hạn có thể làm tín hiệu yếu hoặc bị
  bỏ qua, nên history/outside vẫn tồn tại và manual gate đa tư thế vẫn bắt buộc.
- Vai mất vẫn giữ hành vi hold theo contract hiện tại.
- Manual webcam gate và đa-model gate chưa chạy; chưa được đánh dấu COMPLETE.
