export interface OneEuroParameters { minCutoff: number; beta: number; derivativeCutoff: number }

export interface AvatarMotionConfig {
  freshnessMs: { face: number; hand: number; pose: number };
  loss: { holdMs: number; returnMs: number; recoveryMs: number; filterResetMs: number };
  filter: {
    expressions: OneEuroParameters;
    head: OneEuroParameters;
    arms: OneEuroParameters;
    wrist: OneEuroParameters;
    pole: OneEuroParameters;
    maxTimestampGapMs: number;
  };
  /** Ngưỡng Phase 3A ban đầu; calibration production thuộc Phase 3C. */
  armFrame: {
    minimumPoseVisibility: number;
    /**
     * Hysteresis cho quyết định "landmark quan sát được" (P0-4/5, theo chuyên gia tư vấn).
     * Đang coi là tracked thì cần tụt dưới `visibilityExit` mới rớt trạng thái; đang coi là
     * mất thì cần vượt `visibilityEnter` mới được tính lại — tránh vách đá tại đúng một
     * ngưỡng khiến landmark dao động quanh 0.5 làm cả đoạn xương bật/tắt liên tục.
     */
    visibilityEnter: number;
    visibilityExit: number;
    minimumSegmentLength: number;
    minimumSegmentRatio: number;
    maximumSegmentRatio: number;
    shoulderOuterBoundsMargin: number;
    elbowOuterBoundsMargin: number;
    wristOuterBoundsMargin: number;
    edgeWarningMargin: number;
    elbowOffsetEnterMagnitude: number;
    elbowOffsetExitMagnitude: number;
    minimumNormalizedElbowOffset: number;
    depthDegenerateEnterAlignment: number;
    depthDegenerateExitAlignment: number;
    /**
     * A2: khoảng smoothstep cho `depthQuality`, RỘNG HƠN cặp enter/exit ở trên (theo tư vấn
     * chuyên gia: 0.75→tin khá nhiều, 0.85→tin ít hơn, 0.95→gần như không tin). Tái dùng cặp
     * enter/exit hẹp (0.82–0.90) khiến depthQuality vẫn dốc như vách đá cũ — đo được weight
     * rơi dưới ngưỡng chấp nhận ngay khi vừa chạm enter, không mở rộng được vùng chấp nhận.
     */
    depthQualityFullTrustAlignment: number;
    depthQualityNoTrustAlignment: number;
    /**
     * A2+A4: ngưỡng chấp nhận pole quan sát theo trọng số liên tục
     * `depthQuality * bendPlaneQuality`, có hysteresis (theo tư vấn chuyên gia — "không đổi
     * mode chỉ vì một frame"): đang có pole tươi thì cần weight tụt dưới `Exit` mới rớt; đang
     * không có thì cần vượt `Enter` mới nhận lại. Nếu không, khi thời gian giữa các frame vượt
     * `poleFallbackTimeoutMs`, weight dao động nhẹ quanh một ngưỡng duy nhất làm poleSource
     * nhảy liên tục fresh↔rest — đã đo được hiện tượng này trước khi thêm hysteresis.
     */
    minimumObservedPoleWeightEnter: number;
    minimumObservedPoleWeightExit: number;
    maximumPoleAngularVelocityRadiansPerSecond: number;
    invalidGraceMs: number;
    validRecoveryConfirmMs: number;
    poleFallbackTimeoutMs: number;
    longGapDiscontinuityMs: number;
    calibrationMinimumSamples: number;
    calibrationWindowSamples: number;
    elbowInferenceTimeoutMs: number;
    elbowInferenceReachSlackRatio: number;
    /**
     * Phase 3B partial-arm. Khi khuỷu bị che, `inferElbow` chọn phía gập bằng prior pole. Nếu
     * prior đảo dấu giữa hai frame, nghiệm nhảy sang phía đối diện và cẳng tay quằn qua thân
     * người — đo được trên tay gần duỗi thẳng (bendPlaneQuality ≈ 0.04), nơi pole gần như
     * không xác định nên rất dễ đổi dấu. Dưới ngưỡng này, pole suy biến tới mức không được
     * phép quyết định phía gập: giữ nguyên phía của lần suy đoán/quan sát gần nhất.
     */
    elbowInferenceMinimumBendQuality: number;
    /**
     * Phase 3B partial-arm. `elbowInferenceTimeoutMs` tồn tại để chặn sai số tích luỹ khi suy đoán phải
     * dựa vào dữ liệu CŨ (pole lịch sử, chiều dài chưa chắc chắn). Nhưng khi vai và cổ tay đều
     * được quan sát tươi ngay frame này và chiều dài xương đã calibrate từ quan sát thật, khuỷu
     * là nghiệm hình học đầy đủ — không có gì tích luỹ để mà hết hạn.
     *
     * Đo trên webcam: giơ tay chào để khuỷu ra ngoài khung hình, khuỷu KHÔNG BAO GIỜ quan sát
     * lại được nên đồng hồ inference chạy mãi; sau 1.2 giây tay avatar rơi xuống giữa lúc người
     * dùng vẫn đang giơ. Cờ này cho phép suy đoán chạy vô thời hạn đúng trong điều kiện đủ chắc.
     */
    elbowInferenceUnboundedWhenFullyObserved: boolean;
    /**
     * Phase 3B partial-arm. `inferElbow` giải ra khuỷu trên một ĐƯỜNG TRÒN nghiệm — vô số vị trí đều thoả
     * đúng hai chiều dài xương. Prior pole chọn một điểm trên đó, và khi khuỷu ra ngoài khung
     * hình lâu, prior có thể trỏ vào phía TRONG thân người: nghiệm vẫn đúng toán học nhưng
     * cẳng tay xuyên qua ngực/bụng — đo được trên webcam khi giơ tay chào.
     *
     * Khuỷu người thật luôn lệch ra phía ngoài thân (bên trái lệch trái, bên phải lệch phải).
     * Đây là biên độ tối thiểu theo trục `torso.right` mà nghiệm phải nằm về đúng phía; dưới
     * mức này coi như nghiệm đã lấn vào trong thân và pole bị lật ra ngoài.
     */
    elbowInferenceMinimumLateralBias: number;
    /**
     * Phase 3B partial-arm. Tuổi tối đa của prior pole dùng cho elbow inference. `inferElbow`
     * trước đây đọc `previousPole` không kiểm tra tuổi, trong khi tầng chọn pole của khung
     * xương đã bỏ nó sau `poleFallbackTimeoutMs` — hai bên dùng hai pole khác nhau. Cho phép
     * dài hơn `poleFallbackTimeoutMs` (pole cũ vẫn tốt hơn rest-pose để giữ phía gập) nhưng
     * không vô hạn.
     */
    elbowInferencePoleMaxAgeMs: number;
  };
  /** Mức 2B-5 POC webcam; mọi giá trị theo thời gian thực, không theo frame count. */
  handTwist: {
    missingHoldMs: number;
    missingFadeMs: number;
    deadZoneRadians: number;
    targetFilterTimeConstantSeconds: number;
    correctionLimits: Record<"left" | "right", { minRadians: number; maxRadians: number }>;
  };
}

/** Các duration là giá trị hiệu chỉnh ban đầu, chưa phải ngưỡng chính thức của SRS. */
export const DEFAULT_AVATAR_MOTION_CONFIG: AvatarMotionConfig = {
  freshnessMs: { face: 100, hand: 150, pose: 150 },
  loss: { holdMs: 250, returnMs: 500, recoveryMs: 180, filterResetMs: 750 },
  filter: {
    expressions: { minCutoff: 1.2, beta: 0.03, derivativeCutoff: 1 },
    head: { minCutoff: 1.1, beta: 0.12, derivativeCutoff: 1 },
    arms: { minCutoff: 1, beta: 0.2, derivativeCutoff: 1 },
    wrist: { minCutoff: 1.4, beta: 0.25, derivativeCutoff: 1 },
    pole: { minCutoff: 0.8, beta: 0.12, derivativeCutoff: 1 },
    maxTimestampGapMs: 1_000,
  },
  armFrame: {
    minimumPoseVisibility: 0.5,
    visibilityEnter: 0.6,
    visibilityExit: 0.3,
    minimumSegmentLength: 0.02,
    minimumSegmentRatio: 0.35,
    maximumSegmentRatio: 2.85,
    shoulderOuterBoundsMargin: 0.2,
    elbowOuterBoundsMargin: 0.08,
    wristOuterBoundsMargin: 0.04,
    edgeWarningMargin: 0.04,
    elbowOffsetEnterMagnitude: 0.015,
    elbowOffsetExitMagnitude: 0.03,
    minimumNormalizedElbowOffset: 0.025,
    depthDegenerateEnterAlignment: 0.9,
    depthDegenerateExitAlignment: 0.82,
    depthQualityFullTrustAlignment: 0.75,
    depthQualityNoTrustAlignment: 0.95,
    minimumObservedPoleWeightEnter: 0.08,
    minimumObservedPoleWeightExit: 0.03,
    maximumPoleAngularVelocityRadiansPerSecond: 7,
    invalidGraceMs: 80,
    validRecoveryConfirmMs: 80,
    poleFallbackTimeoutMs: 500,
    longGapDiscontinuityMs: 1_000,
    calibrationMinimumSamples: 3,
    calibrationWindowSamples: 30,
    elbowInferenceTimeoutMs: 1_200,
    elbowInferenceReachSlackRatio: 0.12,
    elbowInferenceMinimumBendQuality: 0.15,
    elbowInferenceUnboundedWhenFullyObserved: true,
    elbowInferenceMinimumLateralBias: 0.05,
    elbowInferencePoleMaxAgeMs: 2_000,
  },
  handTwist: {
    // Occlusion ngắn được debounce 80 ms; sau đó twist cũ phải rời hết trong khoảng 180 ms
    // để không kéo một orientation bàn tay đã lỗi theo Pose arm mới.
    missingHoldMs: 80,
    missingFadeMs: 180,
    deadZoneRadians: 3 * Math.PI / 180,
    targetFilterTimeConstantSeconds: 0.08,
    correctionLimits: {
      // ±90° quanh neutral tương ứng tổng phạm vi 180°, không phải ±180° (tổng 360°).
      left: { minRadians: -90 * Math.PI / 180, maxRadians: 90 * Math.PI / 180 },
      right: { minRadians: -90 * Math.PI / 180, maxRadians: 90 * Math.PI / 180 },
    },
  },
};
