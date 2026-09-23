Mình đã gom toàn bộ ý tưởng trước đây và đối chiếu với trạng thái code hiện tại. Dưới đây là “Master Roadmap mô phỏng con người” của VeilTalk, từ nền tảng bắt buộc đến những phần nghiên cứu xa.
Đây chưa phải thay đổi chính thức trong docs/09_ROADMAP_AND_TASKS.md; trước mắt là bản tổng hợp để chúng ta chốt phạm vi.
Ký hiệu:
✅ Đã có nền tảng.
🟡 Đang làm hoặc mới làm một phần.
⬜ Chưa làm.
🔬 Phần nghiên cứu, webcam chỉ có thể dự đoán hợp lý.
I. VeilTalk hiện đang ở đâu?
Đã có
✅ Face, Pose và Hand Landmarker chạy local.
✅ Không truyền webcam hoặc raw landmark.
✅ VRM renderer parent-local/rest-relative.
✅ Two-bone arm IK.
✅ Anatomical arm frame.
✅ Temporal filtering và hold/fade cơ bản.
✅ Forearm hand twist.
✅ Dựng lại wrist một phần khi Pose thiếu nhưng Hand còn thấy.
✅ Tìm nhiều nghiệm khuỷu và chấm điểm hình học.
✅ Head/torso/arm collision proxy cơ bản.
✅ Năm gesture: open, fist, point, thumbsUp, thumbsDown.
✅ Bộ test tự động khá lớn cho P4-T10.
Chưa được xem là hoàn thành
🟡 Nghiệm thu webcam hai tay và ba avatar.
🟡 Một số lỗi twist/runtime ngẫu nhiên chưa được đóng hoàn toàn.
🟡 Directional thumb swing.
🟡 Gesture ngón tay vẫn là preset, chưa continuous.
🟡 Collision hiện chỉ hỗ trợ chọn nghiệm, chưa phải contact solver.
🟡 Phase 3C về anatomical calibration/constraints chưa làm.
Trạng thái chính thức vẫn là P4-T10 đang thực hiện trong [roadmap hiện tại (line 109)](/C:/project/veiltalk/docs/09_ROADMAP_AND_TASKS.md:109).
II. Roadmap tổng hợp mô phỏng con người
Giai đoạn 0 — Đóng nền chuyển động hiện tại
Độ khó: dễ–trung bình
Ưu tiên: bắt buộc
Hoàn thành manual gate W2–W10.
Kiểm tra cả tay trái và tay phải.
Kiểm tra ít nhất ba avatar VRM.
Khóa convention trục, chirality và quaternion.
Hoàn thiện neutral calibration cho forearm twist.
Kiểm tra reload model không làm mất rig profile.
Thêm anomaly capture local-only khi xuất hiện flip ngẫu nhiên.
Đo live FPS và tracking→render latency đúng protocol.
Loại bỏ hoàn toàn:
Lật tay 180°.
Khuỷu đổi phía đột ngột.
Forearm quét qua mặt.
Upper/lower arm không cùng trạng thái.
Xương co giãn.
NaN/Infinity.
Tay trái/phải bị đổi.
Giật khi reacquire.
Đây là móng. Không nên xây contact hoặc hair interaction trên một cánh tay chưa ổn định.

Giai đoạn 1 — Capability và calibration theo avatar
Độ khó: dễ–trung bình
Ưu tiên: bắt buộc
Capability audit
VeilTalk phải tự kiểm tra model có:
Head, neck, chest, upperChest.
Shoulder/clavicle.
UpperArm, lowerArm, hand.
Đủ bone từng ngón.
Eye bones hoặc LookAt expression.
aa/ih/ou/ee/oh.
Blink, brow, smile, angry, surprised.
Custom ARKit-like expressions.
SpringBone.
Hair collider.
Corrective morph.
Rig calibration
Hướng local axis của từng bone.
Rest basis của palm.
Rest basis của upper/lower arm.
Bone twist axis.
Chiều dài vai–cánh tay–cẳng tay.
Tỉ lệ bàn tay và từng ngón.
Giới hạn chuyển động từng khớp.
Offset giữa skeleton người và avatar.
Phát hiện model có rig bị mirror hoặc exporter bất thường.
Từ chối riêng một tính năng nếu rig không đủ, không làm sập toàn avatar.
Calibration theo người dùng
Tỉ lệ vai.
Chiều dài tay.
Kích thước đầu.
Tỉ lệ thân trên.
Neutral face.
Mức mở miệng tối đa.
Neutral palm.
Rest posture.
Khoảng cách và hướng camera.
Mirror convention.

Giai đoạn 2 — Khuôn mặt hội thoại
Độ khó: trung bình
Ưu tiên: bắt buộc
Miệng và hàm
Tách jawOpen và mouthClose.
Mapping đủ aa/ih/ou/ee/oh.
Môi khép nhanh với m/b/p.
Chu môi.
Phễu môi.
Kéo môi ngang.
Môi trên và dưới độc lập.
Kéo khóe miệng trái/phải.
Cười lệch.
Mím môi.
Hạ môi dưới.
Hàm lệch trái/phải.
Hàm đưa ra trước.
Coarticulation: khẩu hình hiện tại chịu ảnh hưởng âm trước và sau.
Bộ lọc nhanh cho môi, chậm hơn cho má.
Kết hợp webcam và audio lip-sync.
Giữ đồng bộ miệng–audio qua jitter buffer.
Giảm rung môi khi người dùng không nói.
Cơ mặt
Brow inner up.
Brow outer up trái/phải.
Brow down trái/phải.
Cheek squint.
Cheek puff.
Nose sneer.
Smile/frown trái phải.
Eye squint/wide.
Biểu cảm bất đối xứng.
Expression normalization để nhiều blendshape không cộng quá mức.
Expression conflict/override.
Neutral drift correction.
Phần khó hơn
🔬 Ước lượng cảm xúc từ giọng nói.
🔬 Biểu cảm vi mô.
🔬 Lưỡi và răng khi nói.
🔬 Corrective morph cho má, môi và cằm.
Mục tiêu: người xem cảm thấy avatar thực sự đang nói, không còn là một cái hàm mở đóng.

#### Kế hoạch thực thi khuôn mặt hội thoại F0–F7

| Task | Phạm vi | Acceptance criteria | Trạng thái |
|---|---|---|---|
| **F0 ✅** | Facial capability manifest + DEV Lab — Hoàn thành 2026-09-10 | Phân biệt preset có bind thật, preset bind bằng 0, raw morph candidate và unsupported; audit LookAt/eye bone; `/dev/facial` thử độc lập từng kênh, không webcam/upload; raw morph không tự động vào production. Chủ dự án đã xác nhận cả 5 model phản hồi các kênh thử; độ rõ khác nhau theo morph của từng model và sẽ được chuẩn hóa ở F1/F4 | **DONE** |
| **F1 ✅** | Neutral calibration và lifecycle — Hoàn thành 2026-09-10 | Thu neutral local-only; dead zone/adaptive baseline; face loss phải release về neutral, không giữ biểu cảm cũ; reset khi đổi model/session. Chủ dự án xác nhận manual webcam gate PASS sau corrective manual collection chống kẹt 0/30 | **DONE** |
| **F2 ✅** | Blink, mắt và chân mày — Hoàn thành 2026-09-11 | Blink trái/phải, squint/wide, brow inner/outer/down; chống false blink và chuẩn hóa bất đối xứng theo capability model. Chủ dự án xác nhận manual webcam gate PASS sau corrective profile cho morph key số của `reference-avatar-2` | **DONE** |
| **F3 ✅** | Webcam mouth core — Hoàn thành 2026-09-11 | Tách `jawOpen`/`mouthClose`; map đủ `aa/ih/ou/ee/oh`; pucker/funnel/wide; môi trên/dưới và khóe trái/phải nếu model hỗ trợ. Chủ dự án xác nhận manual webcam gate PASS | **DONE** (`F3_WEBCAM_MOUTH_CORE_MATH_PLAN.md`) |
| **F4** | Dynamics và expression mixer | Filter theo nhóm cơ, fast close cho m/b/p, normalization/conflict override, saturation budget và recovery không snap | **FAST-SPEECH HYBRID CORRECTIVE COMPLETE — 61 files / 690 tests + build/lint PASS; chờ manual webcam retest nói nhanh/pucker/m-b-p/silent-smile; D1–D10 vẫn chưa đóng** (`F4_EXPRESSION_DYNAMICS_MIXER_MATH_PLAN.md`) |
| **F5 — DEFERRED** | Audio + webcam fusion | Voice activity/phoneme evidence local-only, jitter buffer và timestamp alignment; silence gate chống rung; audio không thay thế webcam shape khi webcam còn tin cậy | **Chủ dự án quyết định hoãn ngày 2026-09-14. Giữ nguyên harness/kết quả F5-0 làm bằng chứng R&D; không tích hợp Uni2005/HeadAudio vào facial pipeline. Chỉ mở lại nếu telemetry chứng minh webcam liên tục bỏ lỡ toàn bộ peak** (`F5_AUDIO_WEBCAM_FUSION_MATH_PLAN.md`, `F5_0_AUDIO_MODEL_QUALIFICATION_REPORT.md`, `F5_0B_HEADAUDIO_QUALIFICATION_PLAN.md`) |
| **F6** | Conversational expression layer | Smile/frown lệch, cheek/nose/brow coupling có giới hạn, micro-motion deterministic và neutral drift correction; faithful mode vẫn giữ nguyên | **PLAN DRAFT — chờ duyệt trước code** (`F6_CONVERSATIONAL_EXPRESSION_LAYER_MATH_PLAN.md`) |
| **F7** | Multi-model acceptance/performance | Ma trận 5 model; nói chậm/nhanh, m-b-p, năm nguyên âm, cười/cau mày/lệch, face loss/reacquire; tracking→render <100 ms và ≥24 FPS; chỉ profile raw đã nghiệm thu mới được production dùng | Chưa bắt đầu |

F0 không tự suy diễn capability theo tên file. Preset VRM chỉ được coi là dùng được khi expression có ít
nhất một bind thật. Tên raw morph chỉ là candidate trong DEV Lab; muốn đưa vào production phải có profile
theo fingerprint model và manual acceptance riêng. Xác nhận bằng mắt rằng model có thể chớp/há miệng
không thay thế kiểm tra bind/mapping vì một preset có thể tồn tại nhưng không điều khiển target nào.

Audit F2 ngày 2026-09-10, hiệu chỉnh theo GLB metadata ngày 2026-09-11: `reference-avatar-3` giữ tên bộ
phận chân mày VRoid `Fcl_BRW_*` nên dùng profile theo morph suffix. `reference-avatar` và
`reference-avatar-2` có cùng bộ morph nhưng exporter VRM 0 đã bỏ `extras.targetNames`, khiến runtime chỉ
còn key số; hai model dùng allowlist theo đúng fingerprint đã nghiệm thu: brow down/up `6`/`10`, eye wide
`22`, squint trái/phải `19`/`18`.
Không suy đoán key số cho model lạ. `reference-avatar-1` chỉ có bốn raw morph, không có chân mày độc lập
nên capability này phải tắt; `reference-avatar-4` có morph Nhật tách trái/phải nhưng semantic nhướng/cau
mày chưa qua manual mapping. Không được dùng preset cảm xúc toàn mặt để giả chân mày cho model thiếu
capability vì sẽ kéo sai miệng.

Implementation F3 ngày 2026-09-11: thay `aa = jawOpen` bằng mapper hình học webcam thuần, giữ riêng
`jawOpen`/`mouthClose`, suy ra `aa/ih/ou/ee/oh` bằng Low/Mid/High membership và proportional
normalization. Input không hữu hạn được chặn, config được validate một lần trước realtime loop, closure
không bị nhân hai lần. Panel `/dev/avatar-renderer` hiển thị `J/C/O/R/W`, activity, năm vowel và
corrective. Profile VRoid map `Close/Up/Down/Small/Large`; hai VRM 0 mất tên dùng allowlist key số theo
fingerprint và chặn hai semantic sở hữu cùng raw target. Automated gate: **637/637 test PASS**,
production build + lint PASS. Chủ dự án xác nhận manual webcam gate PASS ngày 2026-09-11.

Implementation F4 ngày 2026-09-11: processor trở thành temporal owner duy nhất của expression; renderer bỏ
damping mặt lần hai nhưng vẫn smooth bone. Mixer dùng antagonist difference và available-budget projection
idempotent ở cả pre/post, tách budget theo vùng, dùng canonical `mouthClose` từ F3 và không còn tự sinh preset
`happy` từ khóe miệng. Dynamics bất đối xứng cho mí/môi/mày/má, giữ state sau post-mix, rebase gap dài và xử lý
hold → smoothstep return → exact neutral → reacquire không seed target. DEV panel F4 hiển thị lifecycle,
conflict và budget scale local-only. Corrective 2026-09-11 sau webcam: nụ cười hai khóe được tách thành
`mouthSmileClosed` (`MTH_Fun`) và `mouthSmileOpen` (`MTH_Joy`) bằng smooth transition theo bằng chứng lớn
nhất của `jawOpen` và độ tách môi trên/dưới, có gain
giới hạn và giảm vowel/lip-shape cộng chồng; `mouthFrown` map riêng tới `MTH_Sorrow`. Không bật lại preset
`happy` toàn mặt. Model 2 không còn gán nhầm raw 29/30 thành Narrow/Wide; raw 25 cũng bị bỏ khỏi
`mouthClose` vì forensic vertex bounds chứng minh target Extra này dịch chuyển cả vùng mắt. Với model 2,
closure chỉ triệt vowel về rest pose nên m/b/p không thể điều khiển mí.
Ảnh webcam chứng minh blink bằng 0 nhưng mắt avatar vẫn đóng; vì vậy raw `Fcl_EYE_Joy_L/R` đã bị loại khỏi
production profile thay vì cố suy blink từ squint. Blink thật vẫn độc lập. Pitch đầu đảo X theo convention avatar.
Automated gate: **61 files / 690 tests PASS**, production build + lint PASS; manual webcam retest D1–D10 còn chờ.
Webcam tuning tiếp theo tăng riêng gain cười hở từ `0.50` lên `0.60`; cười kín và closure m/b/p không đổi.

Corrective telemetry ngày 2026-09-14: thêm cửa sổ peak 1 giây theo timestamp ở từng fresh face sample để
panel React 400 ms không bỏ lỡ xung miệng ngắn. Snapshot local-only ghi scalar raw/calibrated jaw, thành phần
geometry F3, vowel/closure tại F3 → F4 desired → dynamic → final, effective face sample rate và đúng semantic
→ model expression/value đã gửi vào renderer; không lưu ảnh/landmark và chưa thay đổi animation. Bước kế tiếp
bắt buộc là webcam baseline nói chậm/nói nhanh để xác định tín hiệu mất ở detector, calibration, F3,
F4 mixer/dynamics hay capability model; không được tăng global `jawOpen` theo cảm tính.

Fast-speech corrective ngày 2026-09-14: activity lấy từ opening/round/non-smile stretch F3; mid-range lift chỉ
khuếch đại tỷ lệ năm viseme đang có, không cộng global jaw hoặc tự sinh một vowel mới. Một normalized shape
envelope decay 90 ms giữ xung ngắn theo wall-clock; shape mới thay ngay shape cũ để không chồng nguyên âm.
Strong closure xóa opening envelope nhưng `mouthClose` vẫn là articulation hợp lệ; face returning/reset và gap
trên 250 ms xóa state. Filter OFF bỏ temporal hold. Adaptive attack không được thêm vì telemetry đã cho thấy
F3 → desired → dynamic → final không attenuation trong sample lỗi; model-specific gain tiếp tục chờ gate đa model.

Manual retest tiếp theo cho thấy avatar vẫn đứng miệng khi nói và pucker nhẹ bị đẩy gần cực đại. Root corrective
không tiếp tục tăng temporal gain: F3 bổ sung aperture hình học từ khe môi trong landmarks 13–14, chiếu lên pháp
tuyến trục hai khóe 61–291 và chuẩn hóa theo bề rộng miệng/video aspect. Jaw semantic lấy max giữa blendshape
đã map và landmark aperture nên chuyển động mở môi thật không còn phụ thuộc duy nhất vào `jawOpen` detector.
Curve pucker/funnel đổi từ `0.07/0.55` sang `0.12/0.85` và `0.10/0.80` để chúm nhẹ không thành toàn lực.
Không thêm audio, thư viện hoặc ảnh/landmark vào packet.

Giai đoạn 3 — Mắt, ánh nhìn và sự chú ý
Độ khó: dễ–trung bình
Ưu tiên: cao
Điều khiển VRM LookAt đúng capability.
Nhìn trái/phải/lên/xuống.
Phân biệt chuyển động mắt với quay đầu.
Clamp mắt theo giải phẫu.
Mí mắt đi theo hướng nhìn.
Blink trái/phải.
Blink tự nhiên khi tracking yếu.
Chống chớp giả do landmark mất.
Saccade nhỏ thay vì mắt trượt tuyến tính.
Vergence khi nhìn vật gần.
Duy trì eye contact khi hội thoại.
Gaze smoothing.
Gaze target prediction.
Chuyển ánh nhìn trước, đầu theo sau.
Tránh “mắt chết” khi người dùng nhìn ít.
Chế độ trung thực và chế độ cinematic gaze.

Giai đoạn 4 — Đầu, cổ, cột sống và vai
Độ khó: trung bình
Ưu tiên: bắt buộc
Head–neck–spine distribution
Không đặt toàn bộ rotation vào đầu. Phải phân phối:
Hips/root → chest → upperChest → neck → head
Cần có:
Head yaw/pitch/roll.
Neck yaw/pitch/roll.
Chest và upperChest.
Spine bend.
Nghiêng thân.
Xoay thân.
Co người.
Ngả người.
Chuyển trọng tâm thân trên.
Clamp riêng từng đốt.
Giữ đầu ổn định tương đối khi thân chuyển động.
Vai và xương đòn
Nhún vai.
Hạ vai.
Vai tiến ra trước/lùi sau.
Xương đòn nâng theo tay.
Vai xoay khi đưa tay ra trước.
Scapula approximation.
Hai vai bất đối xứng.
Vai phản ứng khi chống cằm hoặc tựa đầu.
Không để tay nâng quá cao trong khi vai đứng yên.
Sự sống cơ bản
Nhịp thở.
Chuyển động ngực nhỏ khi nói.
Idle posture.
Postural sway rất nhẹ.
Cử động chỉnh tư thế.
Settle motion sau khi dừng.

Giai đoạn 5 — Cánh tay và cổ tay hoàn chỉnh
Độ khó: trung bình
Ưu tiên: bắt buộc
Cánh tay
Hoàn thiện upper-arm anatomical constraint.
Elbow flexion limit.
Shoulder cone limit.
Elbow-side hysteresis.
Pole continuity.
Giữ nguyên chiều dài xương.
Dự đoán khuỷu khi mất một điểm.
Hai tay độc lập nhưng cùng tham chiếu torso.
Tay không xuyên qua tay còn lại.
Vai và ngực tham gia khi tay vượt vùng với tới.
Reachability solver: mục tiêu ngoài tầm thì thân/vai hỗ trợ.
Cổ tay 3-DoF
Flexion/extension.
Radial/ulnar deviation.
Pronation/supination.
Phân phối twist giữa lowerArm và hand.
Palm orientation tuyệt đối theo rig.
Clamp tư thế bẻ cổ tay cực hạn.
Không để twist phá hướng cẳng tay.
Wrist confidence riêng.
Hòa Pose wrist và Hand wrist.
Reacquire không giật.

Giai đoạn 6 — Ngón tay liên tục
Độ khó: trung bình–khó
Ưu tiên: bắt buộc nếu muốn avatar có sức sống
Mỗi ngón
MCP flexion.
MCP abduction/adduction.
PIP flexion.
DIP flexion.
Coupling PIP–DIP khi DIP không đáng tin.
Giới hạn khớp giải phẫu.
Temporal filter riêng.
Confidence riêng.
Không cong ngược.
Không tạo móng vuốt khi xòe.
Không rung khi giữ bàn tay.
Ngón cái
CMC opposition.
CMC abduction.
MCP flexion.
IP flexion.
Hướng thumb tip.
Phân biệt thumbs-up và thumbs-down liên tục.
Không dùng cùng công thức với bốn ngón còn lại.
Khi bị che
Hold ngắn hạn.
Dự đoán từ pose trước.
Synergy prior: các ngón thường co theo nhóm.
Suy DIP từ PIP.
Blend về pose an toàn.
Không bật giữa preset.
Không khẳng định theo dõi chính xác nếu camera không thấy.
Gesture open/fist/point/... vẫn có thể tồn tại như lớp semantic, nhưng không còn là nguồn duy nhất điều khiển ngón.

Giai đoạn 7 — Temporal Body State và occlusion
Độ khó: khó
Ưu tiên: điểm khác biệt
Mỗi khớp cần trạng thái:
Observed
→ Inferred
→ Predicted
→ Contact-locked
→ Fading
→ Rest
Cần triển khai:
Confidence theo từng khớp, không chỉ toàn bộ tay.
Vận tốc và gia tốc.
Prediction ngắn hạn.
Occlusion detection.
Out-of-frame detection.
Source hysteresis.
Pose/Hand source fusion.
Reacquire blending.
Không thay đổi nghiệm do một frame nhiễu.
History buffer.
Motion consistency score.
Anatomical likelihood score.
Depth consistency score.
Phân biệt mất landmark với người dùng thực sự hạ tay.
Theo dõi tay đi vào vùng khuất.
Theo dõi tay xuất hiện trở lại.
Giữ contact khi tay tạm thời biến mất.
Local anomaly replay không lưu video mặt.

Giai đoạn 8 — Quan hệ chiều sâu trước/sau
Độ khó: khó
Ưu tiên: điểm khác biệt
Tay trước mặt.
Tay cạnh mặt.
Tay sau đầu.
Tay trước/sau thân.
Cánh tay trước/sau tóc.
Tay trái trước/sau tay phải.
Depth state có hysteresis.
Dùng scale bàn tay.
Dùng occlusion boundary.
Dùng lịch sử chuyển động.
Dùng hướng lòng bàn tay.
Dùng thứ tự biến mất/xuất hiện.
Không đổi depth side vì một frame.
Correct render ordering.
Xử lý camera mirror.
🔬 Monocular depth prior nếu hình học không đủ.
Đây là phần bắt buộc để đưa tay ra sau đầu mà avatar không cắt ngang mặt.

Giai đoạn 9 — Collision và contact body
Độ khó: khó
Ưu tiên: “killer feature”
Collision proxy
Head ellipsoid.
Face surface.
Neck capsule.
Chest/torso capsule hoặc ellipsoid.
Shoulder volumes.
Upper/lower arm capsule.
Palm volume.
Finger capsules.
Hair volumes.
Hand–head collision.
Hand–torso collision.
Arm–head collision.
Arm–torso collision.
Arm–arm collision.
Finger–body collision.
Không dùng mesh–mesh collision toàn bộ ngay từ đầu vì rất nặng và dễ rung.
Contact state machine
Approach
→ Near
→ Touch
→ Hold
→ Press/Slide
→ Release
Contact cần có:
Contact target.
Contact point.
Surface normal.
Contact confidence.
Contact anchor.
Tangential slide.
Penetration correction.
Release hysteresis.
Contact lifetime.
Re-solve vai, khuỷu và cổ tay.
Contact không phá giải phẫu.
Contact duy trì khi landmark mất ngắn hạn.
Motion primitive
reach(target)
orient(surface)
touch(target)
press(target)
hold(target)
slide(surface)
release()
occlude(region)
reappear()
grasp(object)
support(weight)
Nhờ đó không phải hard-code hàng nghìn hành động.

Giai đoạn 10 — Các hành động tay–cơ thể
Độ khó: khó
Ưu tiên: demo đặc trưng
Các hành động nên nghiệm thu theo thứ tự:
Tay chạm má.
Tựa má vào lòng bàn tay.
Chống cằm.
Che miệng.
Chạm trán.
Đặt tay lên đầu.
Gãi đầu.
Vuốt tóc.
Xoa cổ.
Đặt tay lên vai.
Khoanh tay.
Tay đặt lên ngực.
Hai tay ôm mặt.
Tay đi ra sau gáy.
Chỉnh tóc sau tai.
Các hành động này không nên là animation clip cố định. Chúng phải xuất hiện từ pose reconstruction + contact primitive.

Giai đoạn 11 — Tóc, quần áo và chuyển động phụ
Độ khó: trung bình–khó
Ưu tiên: sau contact nền
Tóc
SpringBone đúng update order.
Inertia theo chuyển động đầu.
Drag, stiffness và gravity theo nhóm tóc.
Hair–head collision.
Hair–shoulder/chest collision.
Tóc không xuyên mặt.
Chuyển động trễ khi quay đầu.
Tóc hồi lại tự nhiên.
Lực khi bàn tay chạm tóc.
Gãi/vuốt làm tóc phản ứng.
Gió ảo trong scene.
🔬 Suy hướng gió từ optical flow tóc thật.
LOD theo số lượng hair chain.
Quần áo và phụ kiện
Váy, áo, nơ, tai thú, đuôi.
Quán tính.
Collision với cơ thể.
Phản ứng khi tay chạm.
Không rung vô hạn.
Không xuyên quá mức.
Tắt hoặc giảm chất lượng trên máy yếu.

Giai đoạn 12 — Hai tay tương tác
Độ khó: rất khó
Ưu tiên: mở rộng
Theo thứ tự:
Palm–palm contact.
Vỗ tay.
Hai tay đặt cạnh nhau.
Một tay chạm mu bàn tay kia.
Một tay nắm cổ tay kia.
Xoa hai bàn tay.
Nắm hai tay.
Chắp tay.
Khoanh tay.
Finger–finger contact.
🔬 Đan ngón.
Cần:
Hai hand solver phối hợp.
Contact graph nhiều điểm.
Quyết định tay nào chủ động/tay nào bị động.
Collision giữa ngón.
Mutual IK.
Tránh vòng lặp hai solver đẩy nhau.
Pose prior khi hai tay che lẫn nhau.
Đan ngón chính xác bằng webcam đơn không bảo đảm được; chỉ có thể dựng tư thế hợp lý.

Giai đoạn 13 — Tương tác vật thể và môi trường
Độ khó: rất khó
Ưu tiên: stretch goal
Nhận diện vật thể.
Pose 3D của vật thể.
Grip region.
Palm orientation theo bề mặt.
Finger wrap.
Object–hand contact.
Object–body collision.
Một tay cầm vật.
Hai tay cầm vật.
Đặt vật lên bàn.
Chuyển vật giữa hai tay.
Điện thoại, cốc, bút, microphone.
Hiểu mặt bàn/ghế/tường.
🔬 Ước lượng trọng lượng và lực phản ứng.
Nên bắt đầu chỉ với một hoặc hai loại vật thể đã biết, không làm object tùy ý ngay.

Giai đoạn 14 — Hành vi giao tiếp có sức sống
Độ khó: khó
Ưu tiên: sau khi tracking trung thực đã ổn
Trạng thái đang nói.
Trạng thái đang nghe.
Eye contact.
Gật đầu nhỏ.
Phản ứng khi người kia nói.
Thay đổi tư thế khi im lặng lâu.
Gesture theo nhịp câu.
Biểu cảm theo giọng nói.
Breathing theo speech phrase.
Gaze chuyển giữa camera và đối phương.
Micro-saccade.
Anticipation.
Follow-through.
Ease-in/ease-out.
Overshoot nhỏ.
Settle motion.
Secondary hand gesture.
Tránh lặp animation máy móc.
Nên có hai chế độ:
Faithful: ưu tiên sao chép người dùng.
Cinematic: thêm chuyển động phụ và làm rõ biểu cảm.
AI không được tự thêm cử chỉ có thể làm sai ý nghĩa trong chế độ trung thực.

Giai đoạn 15 — Motion prior và AI completion
Độ khó: rất khó/nghiên cứu
Ưu tiên: sau solver hình học
AI chỉ đề xuất pose; anatomical/contact solver có quyền từ chối.
Ứng dụng:
🔬 Hoàn thiện tay sau đầu.
🔬 Dự đoán khuỷu bị che lâu.
🔬 Dự đoán ngón khi nắm vật.
🔬 Suy tư thế gãi đầu.
🔬 Hoàn thiện chuyển động giữa hai quan sát.
🔬 Nhận biết motion primitive.
🔬 Phân biệt vuốt tóc với đưa tay ngang đầu.
🔬 Motion style theo từng người.
🔬 Sinh chuyển động nghe/nói.
🔬 Cân bằng giữa trung thực và đẹp.
Cần dữ liệu:
Skeleton sequence.
Confidence.
Contact labels.
Occlusion labels.
Hành động đại diện.
Không cần lưu hoặc upload video mặt nếu thiết kế dataset từ packet local.
Không nên đưa neural model vào quá sớm. Nếu solver nền còn sai, model học máy chỉ che lỗi mà khó kiểm chứng.

Giai đoạn 16 — Full body
Độ khó: rất khó
Ưu tiên: hướng phát triển
Root translation.
Pelvis.
Spine toàn thân.
Hip.
Knee.
Ankle.
Foot.
Balance.
Center of mass.
Foot lock.
Chống trượt chân.
Ngồi/đứng.
Đi bộ.
Xoay người.
Cúi người.
Squat.
Contact với sàn và ghế.
Chuyển trọng lượng giữa hai chân.
Prediction phần chân ngoài camera.
Webcam bàn làm việc không thể thấy chân, nên phần này cần camera toàn thân hoặc phần cứng khác nếu muốn trung thực.

Giai đoạn 17 — Cơ, da và mô mềm
Độ khó: nghiên cứu rất xa
Ưu tiên: không thuộc lõi đồ án
Corrective shoulder morph.
Corrective elbow morph.
Corrective wrist morph.
Muscle bulge.
Skin sliding.
Má bị ép khi tựa tay.
Môi biến dạng khi chạm.
Ngón ép lên da.
Quần áo bị đẩy.
Tóc bị tách khi vuốt.
Soft-body approximation.
Pressure estimation.
VRM thông thường không có đủ rig/morph cho tất cả phần này. Muốn làm cần model avatar được thiết kế riêng.

Giai đoạn 18 — Chất lượng hình ảnh và cảm giác điện ảnh
Độ khó: trung bình–rất khó
Ưu tiên: sau chuyển động
Ánh sáng phù hợp scene.
Eye highlight.
Skin shading.
Contact shadow.
Shadow tay lên mặt.
Ambient occlusion.
Correct transparency cho tóc.
Motion blur nhẹ.
Camera framing.
Facial close-up LOD.
Anti-aliasing.
Expression corrective.
Tối ưu texture/material.
Không để ánh sáng làm mất mắt hoặc môi.
Stylization nhất quán.
Animation tốt nhưng thiếu contact shadow vẫn khiến tay trông như đang nổi trước mặt.

III. Hệ thống đánh giá bắt buộc
Mỗi giai đoạn phải có metric, không chỉ nhìn bằng mắt.
Tracking và giải phẫu
Flip count.
Elbow-side change count.
Joint-limit violation.
Bone-length error.
Angular jitter.
Reacquire discontinuity.
Thời gian hold/fade/recovery.
Tỉ lệ pose observed/inferred/predicted.
Contact
Penetration depth.
Contact jitter.
Contact false positive.
Contact false negative.
Thời gian giữ contact.
Sai số contact anchor.
Số frame bàn tay xuyên đầu/thân.
Khuôn mặt
Lip closure latency.
Audio–mouth offset.
Blink false positive.
Gaze jitter.
Expression saturation.
Neutral drift.
Hiệu năng
Camera FPS.
Tracking FPS.
Solver time.
Collision time.
Render frame time.
Tracking→render latency.
Packet size và send rate.
RAM/VRAM.
Startup/model load.
Chế độ gọi thường và đang ghi hình.
Bộ demo chuẩn
Nói chậm và nói nhanh.
Cười lệch, cau mày, nhướn mày.
Nhìn bốn hướng.
Nghiêng đầu và thân.
Nhún từng vai.
Vẫy và chỉ tay.
Xòe/nắm/co từng ngón.
Xoay cổ tay.
Che một phần wrist/elbow.
Chạm má.
Chống cằm.
Che miệng.
Gãi đầu.
Vuốt tóc.
Tay đi trước/sau đầu.
Hai tay chạm nhau.
Mất tracking rồi xuất hiện lại.
Reload avatar trong khi tracking.
Gọi thật giữa hai thiết bị.
Ghi hình trong lúc avatar chuyển động.
IV. Thứ tự thực hiện tối ưu trong một năm
Tầng bắt buộc — Reliable Avatar
Đóng P4-T10 hiện tại.
Capability và rig calibration.
Khuôn mặt.
Mắt.
Head–neck–chest.
Vai.
Cổ tay.
Ngón tay liên tục.
Benchmark khi gọi thật.
Tầng tạo khác biệt — Contact Avatar
Temporal body state.
Occlusion/depth ordering.
Collision proxy toàn thân trên.
Contact state machine.
Chạm má/chống cằm/che miệng.
Đưa tay ra sau đầu.
Gãi đầu/vuốt tóc.
Hair response.
Tầng tham vọng — Interaction Avatar
Hai tay tương tác.
Một số vật thể đã biết.
Motion primitive recognition.
Motion prior cho vùng bị che.
Cinematic animation layer.
Tầng nghiên cứu tương lai
Đan ngón chính xác.
Vật thể tùy ý.
Full body ngoài khung hình.
Mô mềm và áp lực tiếp xúc.
Từng sợi tóc.
Bản sao chính xác mọi chuyển động bị che.
V. Phạm vi nên chốt cho đồ án
Mục tiêu tốt nhất trong một năm là:
VeilTalk tái dựng khuôn mặt và thân trên theo thời gian thực từ webcam; duy trì giải phẫu khi khớp bị che; hỗ trợ ngón tay liên tục, quan hệ trước/sau và contact tay với đầu/mặt/thân; toàn bộ tracking chạy local và chỉ truyền pose cùng âm thanh.
Demo nổi bật:
Nói nhanh nhưng miệng vẫn có khẩu hình.
Mắt, đầu, cổ, ngực và vai phối hợp.
Tay không flip khi xoay.
Ngón tay không còn preset cứng.
Chống má.
Chống cằm.
Gãi đầu hoặc vuốt tóc.
Đưa tay ra sau đầu rồi trở lại.
Tóc phản ứng theo chuyển động.
Người bên kia nhận được chuyển động qua cuộc gọi.
Nếu đạt tới đây ổn định, VeilTalk đã không còn là “một nhân vật 3D biết nhúc nhích”. Nó trở thành một hệ thống performance capture thân trên có nhận thức về giải phẫu, che khuất và tiếp xúc. Hai tay đan nhau, vật thể tùy ý, full body và mô mềm sẽ là lớp nghiên cứu tiếp theo, không phải điều kiện để đồ án thành công.

# ROADMAP NÂNG CẤP AVATAR — VEILTALK

**Mã roadmap:** AR (Avatar Roadmap)  
**Phiên bản:** 1.0  
**Ngày tạo:** 09/09/2026  
**Trạng thái:** ACTIVE — được ưu tiên triển khai trước khi quay lại luồng còn lại của `09_ROADMAP_AND_TASKS.md`

## 1. Mục đích và ranh giới

Roadmap này quản lý riêng việc nâng cấp avatar VeilTalk từ retargeting cơ bản thành hệ thống
performance capture thân trên có nhận thức về giải phẫu, che khuất và tiếp xúc.

- `docs/09_ROADMAP_AND_TASKS.md` vẫn là roadmap sản phẩm chính và **không bị thay thế hoặc sửa trạng thái** bởi tài liệu này.
- Trong thời gian roadmap AR đang active, việc phát triển avatar đi theo thứ tự và gate trong tài liệu này.
- Khi một task AR hoàn thành, chỉ đánh dấu trong tài liệu này. Chỉ đồng bộ kết quả về roadmap 09 khi có quyết định quay lại luồng chính.
- Toàn bộ Face/Pose/Hand tracking, calibration, solver và anomaly capture phải chạy local trong browser.
- Không truyền video, ảnh khuôn mặt, `RawTrackingFrameV1` hoặc raw landmark. Chỉ pose đã lọc/solve và audio được phép rời browser.
- Không thêm thư viện hoặc neural model mới nếu chưa được duyệt.

## 2. Trạng thái xuất phát

### Đã có nền tảng

- Face, Pose và Hand Landmarker local-only.
- VRM renderer parent-local/rest-relative và vòng render riêng.
- Two-bone arm IK, anatomical arm frame và giữ chiều dài xương.
- Temporal filtering, hold/fade/recovery cơ bản theo từng đoạn tay.
- Forearm hand twist và wrist reconstruction một phần.
- Candidate search cho khuỷu với face clearance và collision proxy cơ bản.
- Hạ tầng năm gesture `open`, `fist`, `point`, `thumbsUp`, `thumbsDown`.
- DEV harness, diagnostics và test tự động của P4-T10.

### Chưa được coi là hoàn thành

- Manual webcam gate W2–W10 cho hai tay và tối thiểu ba VRM.
- Directional thumb swing và gesture runtime chưa đóng nghiệm thu.
- Ngón tay vẫn theo semantic preset, chưa continuous.
- Collision mới hỗ trợ lựa chọn nghiệm; chưa có contact solver/state machine.
- Anatomical calibration/constraint tổng quát (Phase 3C) chưa làm.
- Chưa có khuôn mặt hội thoại, gaze, torso/shoulder đầy đủ và bộ metric AR thống nhất.

## 3. Cách thực hiện mỗi task

Mỗi task phải theo trình tự:

1. Đọc task trong roadmap này và tài liệu tham chiếu được ghi ở task.
2. Đọc code/tài liệu của các dependency đã hoàn thành.
3. Viết kế hoạch kỹ thuật và acceptance matrix; chờ duyệt trước khi sửa code.
4. Cài đặt theo lát cắt nhỏ, không trộn nhiều solver chưa có baseline.
5. Viết unit/integration/replay test; thực hiện manual webcam gate nếu task yêu cầu.
6. Ghi metric trước/sau, kiểm tra privacy và hiệu năng.
7. Cập nhật roadmap này cùng các tài liệu kiến trúc, test, performance và codebase bị ảnh hưởng.

Một task chỉ được đánh dấu ✅ khi tất cả automated gate, manual gate và tài liệu của task đều hoàn thành.
`CODE COMPLETE` không đồng nghĩa `DONE`.

## 4. Release gates

| Release | Mục tiêu | Điều kiện ra khỏi release |
|---|---|---|
| **AR-R1 — Reliable Avatar** | Avatar trung thực và ổn định từ mặt đến thân trên | Không flip/snap; face, gaze, torso, vai, tay, cổ tay và ngón continuous đạt gate đa model; benchmark cuộc gọi thật đạt NFR |
| **AR-R2 — Contact Avatar** | Hiểu che khuất, chiều sâu và contact tay–cơ thể | Contact má/cằm/miệng và tay sau đầu ổn định; không xuyên hình nghiêm trọng; hair response nền hoạt động |
| **AR-R3 — Interaction Avatar** | Hai tay, vật thể biết trước và chuyển động giao tiếp | Demo hai tay và ít nhất một vật thể biết trước; cinematic layer không làm sai faithful mode |
| **AR-R4 — Research** | Full body, motion prior và mô mềm | Không phải điều kiện hoàn thành đồ án; mỗi hạng mục cần quyết định nghiên cứu riêng |

## 5. Danh sách công việc

### AR0 — Đóng nền P4-T10 hiện tại

| Task | Công việc | Acceptance criteria | Phụ thuộc | Ước tính |
|---|---|---|---|---:|
| **AR0-T01 ✅** | Đóng manual gate cánh tay/cổ tay — Hoàn thành 2026-09-10 | Chủ dự án xác nhận đóng manual gate sau các corrective che vai/khuỷu/camera-axis đạt mức chấp nhận; không còn lỗi quơ loạn nghiêm trọng. Camera-axis chủ động degrade về previous/rest vì webcam đơn không đủ depth evidence. | Nền P4-T10 hiện tại | 8–12h |
| **AR0-T02 — DEFERRED** | Đóng directional thumb và năm gesture | Chủ dự án quyết định ngày 2026-09-10 hoãn phần ngón tay vì độ khó; giữ nguyên code và automated regression hiện có, chưa tuyên bố manual acceptance hoặc DONE | AR0-T01 | 6–10h |
| **AR0-T03 — DEFERRED** | Anomaly capture local-only | Chủ dự án quyết định hoãn ngày 2026-09-10; hiện chưa có ring buffer/trigger/export JSON nên không được xem là DONE | AR0-T01 | 4–6h |
| **AR0-T04 — DEFERRED** | Baseline hiệu năng LIVE | Chủ dự án quyết định hoãn ngày 2026-09-10; benchmark LIVE 60 giây và tracking→render avg/p95 vẫn chưa được xác minh, không được xem là DONE | AR0-T01,T02 | 4–6h |
| **AR0-T05 — DEFERRED** | Chốt foundation gate | Chủ dự án quyết định hoãn ngày 2026-09-10; foundation/release gate chưa đạt vì AR0-T02–T04 chưa hoàn thành, không được xem là DONE | AR0-T02,T03,T04 | 2–4h |

### AR1 — Capability và calibration

| Task | Công việc | Acceptance criteria | Phụ thuộc | Ước tính |
|---|---|---|---|---:|
| **AR1-T01 — NEXT (DEPENDENCY WAIVER)** | Avatar capability manifest | Audit bone, finger chain, eye/LookAt, viseme/expression, SpringBone/collider/corrective morph; capability thiếu chỉ disable tính năng tương ứng. Chủ dự án chấp nhận chuyển tiếp ngày 2026-09-10 dù AR0-T05 deferred; waiver không biến AR0-T02–T05 thành DONE | AR0-T01; owner waiver cho AR0-T05 | 8–12h |
| **AR1-T02** | Rig calibration tổng quát | Suy local axis, rest basis, twist axis, bone length, hand/finger scale, joint limits; phát hiện mirror/exporter bất thường; profile immutable theo model generation | AR1-T01 | 12–20h |
| **AR1-T03** | User/camera calibration | Vai, tay, đầu, thân trên, neutral face/palm/rest posture và camera mirror/distance; reset đúng khi đổi model/camera | AR1-T02 | 10–16h |
| **AR1-T04** | Calibration acceptance | ≥3 VRM khác rig; cùng chuyển động cho kết quả giải phẫu tương đương; reload không dùng profile cũ; metric và fallback được ghi rõ | AR1-T03 | 6–10h |

### AR2 — Khuôn mặt hội thoại

| Task | Công việc | Acceptance criteria | Phụ thuộc | Ước tính |
|---|---|---|---|---:|
| **AR2-T01** | Face expression normalization | Map capability-dependent cho brow/cheek/nose/smile/frown/squint/wide; xử lý bất đối xứng, conflict và saturation; neutral drift correction | AR1-T04 | 12–20h |
| **AR2-T02** | Mouth/jaw/viseme solver | Tách jaw/mouth close; aa/ih/ou/ee/oh; corner/upper/lower lip; mím/chu/phễu; filter theo vùng | AR2-T01 | 16–24h |
| **AR2-T03** | Webcam + audio lip-sync fusion | Coarticulation, voice activity, đóng môi nhanh cho m/b/p, jitter alignment; không rung môi khi im lặng | AR2-T02 | 16–24h |
| **AR2-T04** | Face gate | Nói chậm/nhanh, biểu cảm lệch và tracking yếu trên ≥3 VRM; đo lip closure latency, audio–mouth offset, saturation và neutral drift | AR2-T03 | 8–12h |

### AR3 — Mắt, ánh nhìn và sự chú ý

| Task | Công việc | Acceptance criteria | Phụ thuộc | Ước tính |
|---|---|---|---|---:|
| **AR3-T01 — CODE COMPLETE; MANUAL RETEST PENDING** | Gaze Core | Semantic yaw/pitch độc lập capability model; VRM LookAt usable hoặc đủ hai eye bones; rest-relative adapter, clamp, temporal/loss/reacquire và telemetry head-relative. Manual smoke xác nhận mắt chạy tốt nhưng hơi nhanh; corrective giảm response và dùng 85% adapter range. Automated 68 files / 723 tests, lint và build PASS; chờ retest + unified đa-model gate | AR1-T04 | 10–16h |
| **AR3-T02 — CODE COMPLETE; CAPABILITY/MANUAL PENDING** | Blink và eyelid coupling | F2 tiếp tục sở hữu blink. Code chỉ thêm mí theo gaze khi adapter không tự xử lý mí và exact target đã được profile xác nhận; model không đủ điều kiện no-op có reason, không fallback | AR3-T01,T04A | 4–8h |
| **AR3-T03 — CODE COMPLETE; MANUAL PENDING** | Faithful/cinematic gaze | Faithful vẫn mặc định; cinematic opt-in gồm soft attention bias, deterministic saccade/idle blink và transition blend; prediction chưa thêm vì chưa có telemetry chứng minh cần; không convergence | AR3-T01 | 8–14h |
| **AR3-T04A — TOOLING COMPLETE; MANUAL PENDING** | Core eye gate | DEV harness có raw/fused/head/applied telemetry và local scalar metric cho jitter/clamp/invalid/reacquire; còn chạy E1–E12 trên ≥3 VRM capability-diverse | AR3-T01 | 5–8h |
| **AR3-T04B — TOOLING COMPLETE; MANUAL PENDING** | Cinematic eye gate | Automated gate deterministic/bounded/loss suppression PASS; DEV có mode + attention control và cinematic telemetry; còn manual chạy chung sau T02–T04 | AR3-T03 | 3–5h |

### AR4 — Đầu, cổ, thân trên và vai

| Task | Công việc | Acceptance criteria | Phụ thuộc | Ước tính |
|---|---|---|---|---:|
| **AR4-T01 ✅ — DONE** | Head–neck–spine distribution | Packet V2, Face+shoulder neutral, source hysteresis/transition và capability redistribution đã nối; pitch Face và Pose yaw thống nhất; V1 giữ head legacy tới khi calibration sẵn sàng. Chủ dự án nghiệm thu AR4 ngày 2026-09-16 | AR1-T04 | 12–18h |
| **AR4-T02 ✅ — DONE; CURL N/A** | Torso motion | `shoulder-only` là baseline cho khung gọi thường; `full-torso` chỉ khi ≥80% calibration pair có hông tốt, mất hông blend 220 ms. Curl disabled/N/A. Chủ dự án nghiệm thu AR4 ngày 2026-09-16 | AR4-T01 | 10–16h |
| **AR4-T03 ✅ — DONE** | Shoulder/clavicle/scapula | Shrug một/cả hai vai dùng image-space vai–tai, fallback mũi–tâm vai, aspect correction và scale-invariant shoulder span, không bắt buộc hông; AR4-T03.1 thêm vertical shoulder translation và bounded reach assist. Chủ dự án nghiệm thu AR4 ngày 2026-09-16 | AR4-T02 | 14–22h |
| **AR4-T04 ✅ — DONE** | Breathing, idle và settle | Pause-safe breathing, speechChest riêng, faithful/cinematic sway và exact-neutral lifecycle đã nối. Chủ dự án nghiệm thu AR4 ngày 2026-09-16 | AR4-T03 | 8–12h |
| **AR4-T05 ✅ — DONE BY OWNER ACCEPTANCE** | Upper-body gate | DEV telemetry và automated gate PASS. Chủ dự án xác nhận đủ điều kiện đóng AR4 ngày 2026-09-16; full matrix đa model và benchmark chưa có bằng chứng được giữ làm verification follow-up, không chặn AR5 | AR4-T04 | 6–10h |
| **AR4-T06 ✅ — DONE BY OWNER ACCEPTANCE** | Hybrid torso fore/aft lean | Code/automated gate hoàn tất; corrective fore/aft visual PASS trên model đã thử. Chủ dự án đóng task ngày 2026-09-16; full TL-U1→TL-U17 đa model và benchmark được deferred, không được diễn giải là đã chạy PASS | AR4-T05 | 16–24h |

Kế hoạch chi tiết nằm tại `docs/AR4_HEAD_NECK_TORSO_SHOULDER_IMPLEMENTATION_PLAN.md` và
`docs/AR4_T06_HYBRID_TORSO_LEAN_PLAN.md`. **AR4-T01→T06 đã DONE theo xác nhận trực tiếp của chủ dự án
ngày 2026-09-16.** Xác nhận này cho phép chuyển dependency sang AR5. Full manual matrix đa model và benchmark
60 giây/model chưa có bằng chứng vẫn được ghi trung thực là verification follow-up/deferred, không suy diễn thành PASS.

### AR5 — Cánh tay và cổ tay hoàn chỉnh — TẠM GÁC

> **OWNER PRIORITY UPDATE — 2026-09-23:** AR5-T01→T05 được tạm gác để ưu tiên hoàn thiện AR6 Finger
> trên baseline arm/wrist hiện hành. Quyết định này chỉ đổi thứ tự triển khai, không đánh dấu bất kỳ task AR5
> nào là `DONE` và không xóa corrective plan của AR5-T01. Khi quay lại AR5, phải chạy regression toàn bộ AR6,
> đặc biệt ownership `leftHand`/`rightHand`, forearm twist, palm orientation và loss/reacquire, trước khi nghiệm thu.

| Task | Công việc | Acceptance criteria | Phụ thuộc | Ước tính |
|---|---|---|---|---:|
| **AR5-T01 — DEFERRED; IMPLEMENTATION ROLLED BACK** | Anatomical arm constraints | Lần triển khai thử ngày 2026-09-16 gây lỗi chuyển động tay và đã được gỡ; runtime hiện trở về baseline `main`. Kế hoạch toán/code được giữ cho corrective review sau AR6; AR5-T01 chưa DONE | AR1-T04,AR4-T06 | 14–22h |
| **AR5-T02 — DEFERRED** | Reachability solver | Vai/ngực/thân hỗ trợ mục tiêu ngoài tầm; hai tay dùng chung torso nhưng state độc lập; bone length invariant | AR5-T01 | 12–20h |
| **AR5-T03 — DEFERRED** | Wrist 3-DoF | Flex/extend, radial/ulnar, pronation/supination; twist distribution; palm absolute; clamp và confidence riêng | AR5-T02 | 12–20h |
| **AR5-T04 — DEFERRED** | Pose–Hand fusion và reacquire | Source hysteresis, wrist fusion, partial observation và recovery không giật | AR5-T03 | 10–16h |
| **AR5-T05 — DEFERRED** | Arm/wrist gate | Hai tay, cross-body, gần mặt, partial wrist/elbow và reload trên ≥3 VRM; metric flip, elbow switch, bone error, jitter, reacquire | AR5-T04 | 8–12h |

### AR6 — Ngón tay liên tục — ƯU TIÊN TIẾP THEO

> AR6 được phép bắt đầu trước AR5-T05 theo owner waiver ngày 2026-09-23, sử dụng arm/wrist baseline hiện hành.
> Trong thời gian AR5 còn deferred, AR6 không được thay ownership forearm/wrist, không tự bổ sung reachability
> hoặc wrist 3-DoF, và phải giữ finger output tách khỏi các khóa arm hiện có. Việc hoàn thành AR6 không thay thế
> AR5; AR7/R1 vẫn phải đợi cả AR5-T05 và AR6-T04.

| Task | Công việc | Acceptance criteria | Phụ thuộc | Ước tính |
|---|---|---|---|---:|
| **AR6-T01 — NEXT** | Continuous four-finger solver | MCP flex/abduction, PIP/DIP, coupling, per-joint limit/filter/confidence; không cong ngược/móng vuốt | Owner waiver: baseline P4-T10/AR4; AR5-T05 deferred | 16–24h |
| **AR6-T02** | Continuous thumb solver | CMC opposition/abduction, MCP/IP flex và thumb-tip direction theo rig; không dùng công thức bốn ngón | AR6-T01 | 12–20h |
| **AR6-T03** | Finger occlusion handling | Hold/predict/synergy prior/DIP inference/safe fade; không bật giữa preset; semantic gesture chỉ là lớp bổ trợ | AR6-T02 | 12–18h |
| **AR6-T04** | Finger gate | Xòe/nắm/chỉ/co từng ngón/xoay palm; occlusion/reacquire; ≥3 VRM; jitter và joint violation trong ngưỡng duyệt | AR6-T03 | 8–12h |

Kế hoạch production chi tiết, toán đã hiệu chỉnh, migration khỏi gesture preset và gate T01→T04 nằm tại
`docs/AR6_CONTINUOUS_FINGER_TRACKING_IMPLEMENTATION_PLAN.md`. AR6 bắt đầu trực tiếp bằng production modules;
không có pha prototype riêng. Automated/manual gate vẫn là điều kiện bắt buộc để đánh dấu `DONE`.

### AR7 — Benchmark Reliable Avatar

| Task | Công việc | Acceptance criteria | Phụ thuộc | Ước tính |
|---|---|---|---|---:|
| **AR7-T01** | Packet/receiver compatibility | Pose packet đủ cho face/body/finger mới mà không chứa raw landmark; versioning/fallback rõ; packet size/send rate được đo | AR2-T04,AR3-Core,AR4-T05,AR5-T05,AR6-T04 | 8–14h |
| **AR7-T02** | Benchmark gọi thật | Hai thiết bị: face/body/finger đồng bộ audio; tracking→render <100ms mục tiêu, ≥24 FPS máy tham chiếu, audio–mouth <120ms; đo cả recording mode | AR7-T01 | 10–16h |
| **AR7-T03 — R1 GATE** | Nghiệm thu Reliable Avatar | Bộ demo Reliable chạy lặp lại; không privacy regression; automated/manual/performance report đầy đủ | AR7-T02 | 6–10h |

### AR8 — Temporal Body State và occlusion

| Task | Công việc | Acceptance criteria | Phụ thuộc | Ước tính |
|---|---|---|---|---:|
| **AR8-T01** | Per-joint temporal model | `Observed → Inferred → Predicted → ContactLocked → Fading → Rest`; confidence, velocity, acceleration và history riêng từng khớp | AR7-T03 | 16–24h |
| **AR8-T02** | Occlusion/out-of-frame classifier | Phân biệt landmark mất, khuất, ra khung và người dùng hạ tay; source hysteresis chống một frame nhiễu | AR8-T01 | 14–22h |
| **AR8-T03** | Temporal scoring/recovery | Motion/anatomical/depth consistency; short prediction và reacquire blending; anomaly replay local-only | AR8-T02 | 14–22h |
| **AR8-T04** | Occlusion gate | Che wrist/elbow, tay đi vào vùng khuất và xuất hiện lại; đo state ratio, hold/fade/recovery và discontinuity | AR8-T03 | 8–12h |

### AR9 — Chiều sâu, collision và contact

| Task | Công việc | Acceptance criteria | Phụ thuộc | Ước tính |
|---|---|---|---|---:|
| **AR9-T01** | Depth relation state | Trước/cạnh/sau mặt, đầu, thân, tóc và tay còn lại; hysteresis từ scale, palm, occlusion boundary và history; mirror-safe | AR8-T04 | 16–24h |
| **AR9-T02** | Upper-body collision proxies | Head/face/neck/torso/shoulder/arm/palm/finger/hair proxy theo rig; broad/narrow phase nhẹ; không mesh–mesh toàn phần | AR9-T01 | 16–26h |
| **AR9-T03** | Contact state machine | Approach/Near/Touch/Hold/Press/Slide/Release; target, point, normal, confidence, anchor, lifetime và hysteresis | AR9-T02 | 20–32h |
| **AR9-T04** | Contact-aware re-solve | Penetration correction và re-solve vai/khuỷu/cổ tay; giữ contact qua occlusion ngắn; không phá joint limit | AR9-T03 | 18–28h |
| **AR9-T05** | Contact metrics/gate | Đo penetration, jitter, false positive/negative, anchor error và frame xuyên cơ thể trên tập replay + webcam | AR9-T04 | 10–16h |

### AR10 — Hành động contact đặc trưng

| Task | Công việc | Acceptance criteria | Phụ thuộc | Ước tính |
|---|---|---|---|---:|
| **AR10-T01** | Motion primitive API nội bộ | `reach/orient/touch/press/hold/slide/release/occlude/reappear`; primitive mô tả intent/state, không phải animation clip | AR9-T05 | 10–16h |
| **AR10-T02** | Face contact | Chạm/tựa má, chống cằm, che miệng, chạm trán; contact ổn định và không xuyên nghiêm trọng | AR10-T01 | 18–28h |
| **AR10-T03** | Head/neck/torso contact | Tay lên đầu, sau gáy, cổ, vai, ngực và khoanh tay nền | AR10-T02 | 18–28h |
| **AR10-T04** | Hair-adjacent actions | Gãi đầu, vuốt tóc, chỉnh tóc sau tai; depth/contact đúng trước khi thêm phản ứng tóc | AR10-T03 | 14–22h |
| **AR10-T05** | Characteristic action gate | Toàn bộ hành động trên sinh từ reconstruction + contact primitive; chạy faithful, occlusion và reacquire | AR10-T04 | 10–16h |

### AR11 — Tóc, quần áo và R2 gate

| Task | Công việc | Acceptance criteria | Phụ thuộc | Ước tính |
|---|---|---|---|---:|
| **AR11-T01** | SpringBone baseline | Đúng update order; inertia/drag/stiffness/gravity theo nhóm; hair–head/shoulder/chest collision; hồi ổn định | AR10-T05 | 12–20h |
| **AR11-T02** | Hand–hair response | Contact tay tạo phản ứng tóc có giới hạn; gãi/vuốt không gây rung vô hạn hoặc xuyên mặt nghiêm trọng | AR11-T01 | 16–26h |
| **AR11-T03** | Secondary motion LOD | Quality tier cho tóc/quần áo/phụ kiện; máy yếu có thể giảm/tắt; đo solver/collision/render cost | AR11-T02 | 10–16h |
| **AR11-T04 — R2 GATE** | Nghiệm thu Contact Avatar | Má/cằm/miệng, tay sau đầu, gãi/vuốt tóc và recovery đạt metric; cuộc gọi thật vẫn đạt NFR và privacy gate | AR11-T03 | 8–12h |

### AR12 — Interaction Avatar

| Task | Công việc | Acceptance criteria | Phụ thuộc | Ước tính |
|---|---|---|---|---:|
| **AR12-T01** | Two-hand contact graph | Palm–palm, hand–hand/wrist; active/passive ownership; mutual IK không tạo vòng lặp solver | AR11-T04 | 20–32h |
| **AR12-T02** | Two-hand actions | Vỗ, chạm mu tay, nắm cổ tay, xoa/nắm/chắp/khoanh tay; finger collision khi capability đủ | AR12-T01 | 20–32h |
| **AR12-T03** | Known-object interaction | Chọn đúng 1 loại vật thể đầu tiên sau phê duyệt; pose/grip region/palm orientation/finger wrap/contact | AR12-T02 | 24–40h |
| **AR12-T04** | Communication behavior | Speaking/listening state, eye contact, nod, phrase breathing, anticipation/follow-through/settle; faithful/cinematic tách biệt | AR12-T03,AR3-T04B | 18–28h |
| **AR12-T05 — R3 GATE** | Nghiệm thu Interaction Avatar | Hai tay + một vật thể + cinematic demo; faithful mode không sinh cử chỉ sai nghĩa; performance/privacy đạt gate | AR12-T04 | 8–12h |

### AR13 — Hình ảnh và cảm giác điện ảnh

| Task | Công việc | Acceptance criteria | Phụ thuộc | Ước tính |
|---|---|---|---|---:|
| **AR13-T01** | Lighting/material baseline | Lighting, eye highlight, skin shading, hair transparency và stylization nhất quán trên model tham chiếu | AR7-T03 | 12–20h |
| **AR13-T02** | Contact visual cues | Contact shadow và hand-on-face shadow giúp đọc đúng tiếp xúc; không làm mất mắt/môi | AR9-T05,AR13-T01 | 12–20h |
| **AR13-T03** | Rendering quality/LOD | AA, camera framing, facial close-up LOD, texture/material optimization; quality tiers đạt FPS gate | AR13-T02 | 10–18h |

### AR14 — Backlog nghiên cứu, không chặn đồ án

| Task | Hướng nghiên cứu | Điều kiện được phép bắt đầu | Trạng thái |
|---|---|---|---|
| **AR14-R01** | Motion prior/AI completion cho vùng bị che | R2 ổn định, có skeleton/confidence/contact/occlusion dataset local và baseline hình học đo được | ⬜ Deferred |
| **AR14-R02** | Nhận dạng vật thể tùy ý và môi trường | AR12-T03 chứng minh vật thể biết trước | ⬜ Deferred |
| **AR14-R03** | Full body, balance, foot lock và floor/chair contact | Có camera toàn thân hoặc phần cứng phù hợp; requirement mới được duyệt | ⬜ Deferred |
| **AR14-R04** | Cơ, da, áp lực và mô mềm | Có avatar rig/corrective morph chuyên dụng | ⬜ Deferred |
| **AR14-R05** | Đan ngón chính xác và finger–finger dày đặc | Two-hand solver ổn định và có đủ quan sát; chấp nhận đây là suy đoán với webcam đơn | ⬜ Deferred |
| **AR14-R06** | Từng sợi tóc/optical-flow wind | Hair-chain LOD hiện tại đã đạt hiệu năng và có mục tiêu nghiên cứu rõ | ⬜ Deferred |

## 6. Metric bắt buộc

Mỗi acceptance report phải chọn metric liên quan trong bảng sau và ghi điều kiện đo, baseline,
kết quả, PASS/FAIL. Không nghiệm thu chỉ bằng cảm giác nhìn.

| Nhóm | Metric tối thiểu |
|---|---|
| Giải phẫu/tracking | Flip count; elbow-side change; joint-limit violation; bone-length error; angular jitter; reacquire discontinuity; hold/fade/recovery time; observed/inferred/predicted ratio |
| Contact | Penetration depth; contact jitter; false positive/negative; hold duration; contact-anchor error; số frame xuyên đầu/thân |
| Khuôn mặt/mắt | Lip closure latency; audio–mouth offset; blink false positive; gaze jitter; expression saturation; neutral drift |
| Hiệu năng | Camera/tracking FPS; solver/collision/render time avg+p95; tracking→render latency; packet size/send rate; RAM/VRAM; startup/model-load |
| Vận hành | Normal call và recording; đổi/reload avatar; mất/reacquire tracking; hai thiết bị thật |

Ngưỡng NFR hiện hành vẫn giữ nguyên: tracking→render dưới 100 ms, tối thiểu 24 FPS trên máy
tham chiếu và audio–mouth offset dưới 120 ms. Các metric chưa có ngưỡng phải được baseline và duyệt
trước khi code task tương ứng; không tự đặt ngưỡng sau khi đã nhìn kết quả.

## 7. Bộ demo chuẩn

- Nói chậm, nói nhanh; cười lệch, cau mày, nhướn mày.
- Nhìn bốn hướng; nghiêng đầu/thân; nhún từng vai.
- Vẫy/chỉ; xòe/nắm/co từng ngón; xoay cổ tay.
- Che một phần wrist/elbow rồi xuất hiện lại.
- Chạm má, chống cằm, che miệng.
- Gãi đầu, vuốt tóc, đưa tay trước/sau đầu.
- Hai tay chạm nhau.
- Reload avatar trong khi tracking.
- Gọi thật giữa hai thiết bị và ghi hình khi avatar chuyển động.

## 8. Trình tự ưu tiên và điểm bắt đầu

Thứ tự nền tảng ban đầu là:

`AR0 → AR1 → (AR2, AR3) → AR4 → AR5 → AR6 → AR7/R1 → AR8 → AR9 → AR10 → AR11/R2 → AR12/R3`

Theo quyết định ưu tiên của chủ dự án ngày 2026-09-23, thứ tự triển khai hiện hành được điều chỉnh thành:

`AR4 → AR6 → quay lại AR5 → AR7/R1`

AR2 và AR3 chỉ có thể chạy song song sau AR1; các nhánh còn lại giữ dependency trong bảng. AR13
có thể bắt đầu sau R1 nhưng contact visual cue phải đợi AR9. AR14 luôn deferred cho tới khi điều kiện
riêng được đáp ứng và có phê duyệt.

**Bước tiếp theo: AR6-T01 — Continuous four-finger solver.** Bắt đầu bằng contract/capability của finger rig,
MCP flex/abduction và PIP/DIP cho bốn ngón; giữ output finger tách khỏi arm/wrist baseline. Sau AR6-T04, quay lại
corrective review AR5-T01 và triển khai tuần tự AR5-T01→T05. Không bắt đầu AR7/R1 trước khi cả AR5-T05 và
AR6-T04 được xác nhận `DONE`.

Không bắt đầu contact, hair interaction hoặc AI completion để che lỗi khi foundation arm/wrist chưa qua
gate. Nếu manual gate phát hiện lỗi foundation, mở corrective subtask dưới AR0 và đóng lỗi trước AR0-T02.

## 9. Definition of Done toàn roadmap

Phạm vi mục tiêu của đồ án được coi là đạt khi hoàn thành **AR-R2 — Contact Avatar**:

- Tái dựng realtime khuôn mặt và thân trên từ webcam.
- Duy trì giải phẫu qua occlusion ngắn hạn.
- Ngón tay continuous, quan hệ trước/sau và contact tay với đầu/mặt/thân.
- Tóc có phản ứng nền với chuyển động/contact.
- Người bên kia nhận đúng pose qua cuộc gọi và audio vẫn đồng bộ.
- Toàn bộ tracking chạy local; chỉ pose đã xử lý và audio được truyền.
- Bộ metric, test, demo và báo cáo hiệu năng đều có bằng chứng PASS.

AR-R3 là tầng tham vọng. AR-R4 là hướng nghiên cứu tương lai, không phải điều kiện để đồ án thành công.
