# Ma trận thử nghiệm cơ chế XR cho VeilTalk

> Đối chiếu bổ sung 07/10/2026: [XR tracking runtime, dòng 1–500](XR_TRACKING_RUNTIME_PART1_AUDIT.vi.md). Phân biệt cơ chế đã có (fixed scheduling, adapter, hand conditioning) với phần còn thiếu (tracking worker, Pose Z conditioning, adaptive scheduling); chưa thay đổi runtime trong đợt đối chiếu này.

> Palm apparent-scale/foreshortening fusion và body-local clearance đã có nhánh opt-in: [đợt triển khai tiếp](MOTION_DEPTH_CONTINUATION.vi.md). Chưa có quyết định giữ/default dựa trên webcam.

> Cập nhật triển khai: conditioning, rig reach và palms-together assist đã có code/công tắc thử; depth/provenance/ownership đã được nối. “Chưa thử” trong bảng là **chưa nghiệm thu webcam/XR A/B**, không có nghĩa tất cả còn chưa viết code. Chi tiết và giới hạn: [bản triển khai](MOTION_IMPLEMENTATION_AND_WEBCAM_TEST.vi.md).

> Đợt 2: đã thêm ordering từ Pose thật, sửa body-frame inter-arm correction, FK raw cuối renderer và fingertip flexion assist theo capability model. Xem [triển khai đợt 2](MOTION_ROUND2_CONTACT.vi.md); vẫn chưa nghiệm thu webcam/XR A/B, mesh contact hay interlacing.

Cập nhật 02/10/2026. Đi kèm [báo cáo và kế hoạch A–Z](XR_VEILTALK_MOTION_REVIEW.vi.md). Đây là danh sách giả thuyết và gate; chưa có kết quả A/B webcam, chưa có quyết định bật runtime. Source evidence là khảo sát tĩnh, không chứng minh cơ chế là nguyên nhân XR chuyển động tốt hơn.

Mỗi hàng phải có recording/fixture, commit/config/model, số đo trước/sau và ablation riêng. Cùng video dùng cho so đầu–cuối; cùng landmark observation chỉ dùng cho so tầng thuật toán khi adapter bảo toàn hệ tọa độ, clock và provenance. Nếu khác detector/rig thì phải ghi confounder. Không so các con số pixel/góc ở hệ khác nhau như cùng đại lượng.

| Cơ chế và source XR | Vấn đề/giả thuyết | Nền tương ứng VeilTalk | Invariant phải giữ | Thử nghiệm và quyết định giữ/bỏ | Bước/trạng thái |
|---|---|---|---|---|---|
| Normalized reach, rig measurements; readable 3271–3443, 5855–6301, IK 8947–9157 | Avatar khác tỉ lệ làm wrist/raised palm lệch endpoint | armFrameSolver, normalizedRigProfile, modelLoader; contact IK hiện tách riêng | L1/L2 rig không đổi; bend continuity; partial-arm policy | Thử endpoint objective riêng trên ba rig, đo image alignment và final FK. Giữ khi cải thiện endpoint mà không phá observed directions/partial; bỏ hoặc giới hạn quality nếu regression | K; chưa thử |
| Wrist-relative landmark shape filtering; mocap_lib_module 1237 | Shape/palm/ngón rung nhưng translation cần bám wrist mới | handPalmBasis, continuousFingerSolver, median/angle One Euro | Raw bất biến; shape và translation tách; pinch/open/edge-on còn đúng | Ablation raw vs conditioning trước palm/angles. Đo palm angle, finger jitter và translation/rotation lag. Giữ nếu có lợi ngoài bộ lọc góc hiện hữu | I/N/V; chưa thử |
| Subject scale điều chỉnh filter; mocap pose_adjust 766–925 | Cutoff cố định phản ứng khác khi người tiến/lùi camera | adaptiveBodyProfile, motionConfig, arm/hand temporal | Đơn vị/clock đúng; scale nhiễu không tạo pumping | Giữ pose khi đổi khoảng cách và chuyển động nhanh ở từng scale. Đo jitter, latency, source-switch. Chỉ giữ adaptation có lợi qua nhiều khoảng cách | J/V; chưa thử |
| Depth history/reach bounds; readable 7514–7536, mocap hands_adjust | ±Z flip, depth mơ hồ, tay tiến camera/sau đầu | wristEvidence/reconstruction, contactDepthRelation | Unknown khác observed; hemisphere có age/source/epoch; không gọi là metric depth thật | Replay trước→sau, occlusion và source switch. Đo branch flips, endpoint continuity, uncertainty. Giữ hysteresis nếu không khóa sai hemisphere khi có evidence mới | G/J/S; chưa thử |
| Visibility session, entry/exit, partial fallback; readable 5484–6301, 9318 | Reacquire snap, mất wrist làm mất cả arm | armTemporalState, trackingLoss, twist/finger temporal | Upper cập nhật khi lower thiếu; neutral đúng rig giữ qua che ngắn; prediction hữu hạn | Test loss durations/duplicate/not-sampled/restart. Giữ policy VeilTalk; chỉ thêm cơ chế XR nếu giải quyết failure đo được | E/H/M/V; chưa thử |
| Weighted stickiness/default-motion blending | Hold/return cần mượt nhưng có thể tạo pose giả | idleArmPose, armTemporalState, trackingLoss | Observed pose đáng tin không bị thay; hold/return có giới hạn và diagnostic | Ablation riêng ở uncertainty/loss/release, đo fidelity và reacquire lag. Không dùng như contact evidence; bỏ nếu tăng hút/lag hoặc che lỗi geometry. Phải xác nhận source XR cụ thể trước triển khai | H/V; giả thuyết cần bổ sung source |
| Body target correction, palm offset, peak barrier/z-push; readable 8312–8690, 8987; MMD_SA 14706–15140 | Tay xuyên đầu/thân hoặc collider giữ quá xa | contactRig/probe/correction, renderer body/inter-arm collision | Một coordinator cuối; collider theo pose; no-contact baseline; exact length | N2 phải đạt trước; fit proxy ba model, ablation clearance vs confirmed contact, đo final probe/normal/false attraction | O/P/Q/R/S; chưa thử |
| Palm frame, parent compensation, twist bones; readable 6969–7108, 8730–8945; MMD_SA 9484, 9615 | Rest axes khác model; forearm/wrist/finger mapping sai | handTwistRig, wristSwing, fingerRig, modelLoader | Minimal upper twist; pronation thuộc lower; wrist swing theo frame cuối; không copy MMD constants | Static/pronation/±π/occlusion/open hand trên ba VRM. Học rest/rig validation; chỉ thêm twist distribution nếu rig có capability và đo deformation cần thiết | F/M/N; chưa thử |
| Worker/crop và stale-hand XY translation; mocap 1276–1359, 1557–1884 | Main-thread block hoặc hand/Pose khác tuổi | trackingPipeline/runtime/metrics; hiện serial same-frame | Monotonic clocks, latest frame, age budget, crop→full mapping; stale không là sample mới | Profile cost/queue/transfer; A/B worker riêng và compensation riêng. Bù XY không xử lý rotation/deformation. Giữ khi responsiveness/age cải thiện, không tăng identity/contact lỗi | D/W; chưa thử |
| Hai tay và fingertip contact | Mong muốn crossing/chắp/clasp tốt hơn | handPoseMatching, interArmCollision, bimanual preservation; đợt 2 thêm bounded fingertip flexion search, raw/end-node hoặc estimated probe | Identity một–một; continuous fingers; bounded assist; contact-aware exclusions | Chưa chứng minh XR có dedicated hand↔hand solver trong source đã đọc. D2 đo hành vi trước; U thiết kế theo FK/capability VeilTalk, không gọi là port XR. Chưa mesh/interlace/full bimanual arm IK | T/U; opt-in, chưa nghiệm thu |

Mẫu ghi kết quả cho mỗi hàng:

- ID cơ chế; vấn đề và recording tái hiện; stage gây lỗi dựa trên diagnostic.
- Source/commit/runtime XR; commit VeilTalk trước/sau; config/model/hardware/detector/clock.
- Can thiệp duy nhất; flags các lớp khác; raw/solved/packet/final-FK và latency/jitter/identity metrics.
- Invariants và scene tốt cũ có còn đạt; failures, confounders, missing ground truth.
- Quyết định: giữ tắt để thử tiếp / giữ opt-in / bật sau gate / bỏ; lý do và rollback.

Nếu chưa có số đo hoặc source cụ thể, giữ trạng thái giả thuyết. Kiến trúc dễ bảo trì là mục tiêu riêng; không dùng tuổi dự án, số test hay thiết kế sạch hơn để kết luận VeilTalk vượt XR hoặc đã sẵn sàng production.
