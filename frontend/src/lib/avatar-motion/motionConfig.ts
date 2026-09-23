import { DEFAULT_GESTURE_CLASSIFIER_CONFIG, type GestureClassifierConfig } from "./gestureClassifier";
import { DEFAULT_GESTURE_TEMPORAL_CONFIG, type GestureTemporalConfig } from "./gestureTemporal";
import { DEFAULT_FINGER_POSE_TEMPORAL_CONFIG, type FingerPoseTemporalConfig } from "./fingerPoseTemporal";
import type { MouthExpressionConfig } from "./mouthExpression";
import type { FacialExpressionDynamicsConfig } from "./facialExpressionDynamics";
import { DEFAULT_GAZE_OBSERVATION_CONFIG, type GazeObservationConfig } from "./gazeObservation";
import type { GazeTemporalConfig } from "./gazeTemporal";
import { DEFAULT_GAZE_CINEMATIC_CONFIG, type GazeCinematicConfig } from "./gazeCinematic";
import { DEFAULT_GAZE_EYELID_CONFIG, type GazeEyelidConfig } from "./gazeEyelidCoupling";

export interface OneEuroParameters { minCutoff: number; beta: number; derivativeCutoff: number }

export interface AvatarMotionConfig {
  freshnessMs: { face: number; hand: number; pose: number };
  loss: { holdMs: number; returnMs: number; recoveryMs: number };
  face: {
    neutralCalibrationSamples: number;
    neutralDeadZone: number;
    neutralActivationLimit: number;
    neutralAdaptiveRate: number;
    neutralAdaptiveWindow: number;
    blinkEnter: number;
    blinkExit: number;
    unilateralBlinkConfirmMs: number;
    browEmotionFallbackGain: number;
    browInputOnset: number;
    browInputFull: number;
    mouth: MouthExpressionConfig;
    dynamics: FacialExpressionDynamicsConfig;
  };
  gaze: {
    observation: GazeObservationConfig;
    temporal: GazeTemporalConfig;
    limits: { yawLeft: number; yawRight: number; pitchUp: number; pitchDown: number };
    cinematic: GazeCinematicConfig;
    eyelid: GazeEyelidConfig;
  };
  filter: {
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
     * Phía ngoài thân là prior giải phẫu mềm, không phải luật tuyệt đối vì cử chỉ cross-body có
     * thể đưa khuỷu hơi vào trong. Giá trị này là mốc bắt đầu tính outside penalty; nghiệm đi
     * sâu hơn ngưỡng riêng mới nhận deep-inside penalty lớn.
     */
    elbowInferenceMinimumLateralBias: number;
    /** Trọng số chấm hai nghiệm khuỷu giải tích; outside chỉ là prior mềm. */
    elbowInferencePriorWeight: number;
    elbowInferenceHistoryWeight: number;
    /** Trọng số mềm wrist→middle-MCP khi chọn giữa hai nhánh khuỷu giải tích. */
    elbowInferencePalmWeight: number;
    /** Palm-basis dưới chất lượng hình học này không được phép tác động khuỷu. */
    elbowInferencePalmMinimumQuality: number;
    /** Hạ cấp elbow observed khi hướng cẳng tay ngược palm-forward mạnh hơn giá trị này. */
    elbowObservedPalmRejectAlignment: number;
    /** Số mẫu đều trên toàn đường tròn nghiệm IK; hằng số nhỏ nên thời gian mỗi frame vẫn bị chặn. */
    elbowInferenceCandidateCount: number;
    elbowInferenceFaceWeight: number;
    elbowInferenceFaceSideWeight: number;
    elbowInferenceHeadCollisionWeight: number;
    elbowInferenceTorsoCollisionWeight: number;
    /** Hạ cấp elbow Pose nếu forearm avatar xuyên sâu head capsule mà tay thật không chạm mặt. */
    elbowObservedHeadCollisionRejectPenetration: number;
    elbowInferenceOutsideWeight: number;
    elbowInferenceDeepInsideThreshold: number;
    elbowInferenceDeepInsideWeight: number;
    /**
     * Phase 3B partial-arm. Tuổi tối đa của prior pole dùng cho elbow inference. `inferElbow`
     * trước đây đọc `previousPole` không kiểm tra tuổi, trong khi tầng chọn pole của khung
     * xương đã bỏ nó sau `poleFallbackTimeoutMs` — hai bên dùng hai pole khác nhau. Cho phép
     * dài hơn `poleFallbackTimeoutMs` (pole cũ vẫn tốt hơn rest-pose để giữ phía gập) nhưng
     * không vô hạn.
     */
    elbowInferencePoleMaxAgeMs: number;
  };
  /** Phase 3B.4 — chọn nguồn wrist và debounce theo thời gian thật, không theo số render frame. */
  wristEvidence: {
    handEnterConfirmMs: number;
    handMaxAgeMs: number;
    poseHandMaxDeltaMs: number;
    cadenceEwmaAlpha: number;
    graceCadenceMultiplier: number;
    minimumGraceMs: number;
    maximumGraceMs: number;
  };
  /** Mức 2B-5 POC webcam; mọi giá trị theo thời gian thực, không theo frame count. */
  handTwist: {
    missingHoldMs: number;
    missingFadeMs: number;
    deadZoneRadians: number;
    targetFilterTimeConstantSeconds: number;
    correctionLimits: Record<"left" | "right", { minRadians: number; maxRadians: number }>;
  };
  /**
   * Phase 3B.3 — cử chỉ ngón. Ngưỡng ban đầu đặt theo suy luận, chỉnh theo mô tả khi test webcam;
   * chưa phải giá trị đã nghiệm thu.
   */
  gesture: {
    classifier: GestureClassifierConfig;
    temporal: GestureTemporalConfig;
    pose: FingerPoseTemporalConfig;
  };
  continuousFinger: {
    holdMs:number; predictionEndMs:number; safeReturnEndMs:number; maxPredictionRadiansPerMs:number;
    imageExtensionFacingThreshold:number;
    observationDeadband:{extendedRadians:number;curledRadians:number;fullCurlRadians:number};
    measurementValidation:{windowSize:number;minimumConfidence:number;boneLengthToleranceRatio:number};
    filter:OneEuroParameters;
    humanObservationLimits:{
      mcp:{min:number;max:number}; pip:{min:number;max:number}; dip:{min:number;max:number};
      thumb:{min:number;max:number}; abduction:{min:number;max:number};
      thumbAbduction:{min:number;max:number}; thumbOpposition:{min:number;max:number};
    };
  };
}

/** Các duration là giá trị hiệu chỉnh ban đầu, chưa phải ngưỡng chính thức của SRS. */
export const DEFAULT_AVATAR_MOTION_CONFIG: AvatarMotionConfig = {
  freshnessMs: { face: 100, hand: 150, pose: 150 },
  loss: { holdMs: 250, returnMs: 500, recoveryMs: 180 },
  face: {
    neutralCalibrationSamples: 30,
    neutralDeadZone: 0.015,
    neutralActivationLimit: 0.2,
    neutralAdaptiveRate: 0.01,
    neutralAdaptiveWindow: 0.06,
    blinkEnter: 0.55,
    blinkExit: 0.25,
    unilateralBlinkConfirmMs: 45,
    browEmotionFallbackGain: 1,
    browInputOnset: 0.04,
    browInputFull: 0.4,
    mouth: {
      activation: {
        jawOpen: { onset: 0.06, full: 0.70 },
        mouthClose: { onset: 0.08, full: 0.55 },
        pucker: { onset: 0.12, full: 0.85 },
        funnel: { onset: 0.10, full: 0.80 },
        stretch: { onset: 0.06, full: 0.50 },
        lip: { onset: 0.05, full: 0.50 },
        corner: { onset: 0.05, full: 0.50 },
      },
      landmarkAperture: { onset: 0.02, full: 0.32 },
      aperture: {
        low: { onset: 0.18, full: 0.42 },
        midEnter: { onset: 0.12, full: 0.38 },
        midExit: { onset: 0.55, full: 0.85 },
        high: { onset: 0.40, full: 0.80 },
      },
      pressClosureGain: 0.75,
      roundWideAntagonism: 0.50,
      puckerOpenSuppression: 0.65,
      funnelClosedGain: 0.35,
      aaRoundSuppression: 0.80,
      aaWideSuppression: 0.15,
      roundedBaseEvidence: 0.60,
      epsilon: 1e-6,
    },
    dynamics: {
      initialStepMs: 1_000 / 30,
      dtMaxMs: 80,
      maxContinuousGapMs: 250,
      mouthSpeechCorrective: {
        activityOnset: 0.05,
        activityFull: 0.55,
        midRangeLift: 0.35,
        peakDecayMs: 90,
        strongClosure: 0.65,
        maxContinuousGapMs: 250,
        epsilon: 1e-6,
      },
      groups: {
        eyelid: { attackMs: 10, releaseMs: 30 },
        eyeShape: { attackMs: 25, releaseMs: 60 },
        gaze: { attackMs: 25, releaseMs: 60 },
        lipClosure: { attackMs: 12, releaseMs: 45 },
        vowel: { attackMs: 20, releaseMs: 50 },
        jawLipShape: { attackMs: 25, releaseMs: 60 },
        lipDetail: { attackMs: 35, releaseMs: 90 },
        brow: { attackMs: 45, releaseMs: 100 },
        cheekNose: { attackMs: 70, releaseMs: 150 },
        emotion: { attackMs: 90, releaseMs: 180 },
        other: { attackMs: 35, releaseMs: 90 },
      },
      mixer: {
        priorityExponent: 1,
        epsilon: 1e-6,
        smile: {
          openOnset: 0.12,
          openFull: 0.5,
          closedGain: 0.45,
          openGain: 0.6,
          frownGain: 0.55,
          vowelSuppression: 0.75,
          lipShapeSuppression: 0.8,
        },
        budgets: {
          lipShape: 0.8,
          mouthBase: 1.35,
          lipVerticalPerSide: 0.8,
          mouthCornerPerSide: 1,
          cheekNosePerSide: 0.8,
          emotion: 1,
        },
      },
    },
  },
  gaze: {
    observation: DEFAULT_GAZE_OBSERVATION_CONFIG,
    temporal: {
      // Manual AR3 tuning 2026-09-14: giảm phản ứng vi mô và tốc độ bắt mục tiêu để mắt bớt giật.
      filter: { minCutoff: 1.15, beta: 0.035, derivativeCutoff: 1 },
      maximumTimestampGapMs: 500,
      holdMs: 120,
      returnMs: 240,
    },
    limits: { yawLeft: 0.9, yawRight: 0.9, pitchUp: 0.75, pitchDown: 0.65 },
    cinematic: DEFAULT_GAZE_CINEMATIC_CONFIG,
    eyelid: DEFAULT_GAZE_EYELID_CONFIG,
  },
  filter: {
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
    elbowInferencePriorWeight: 0.2,
    elbowInferenceHistoryWeight: 0.65,
    elbowInferencePalmWeight: 1.1,
    elbowInferencePalmMinimumQuality: 0.35,
    elbowObservedPalmRejectAlignment: -0.35,
    elbowInferenceCandidateCount: 24,
    elbowInferenceFaceWeight: 4,
    elbowInferenceFaceSideWeight: 0.75,
    elbowInferenceHeadCollisionWeight: 8,
    elbowInferenceTorsoCollisionWeight: 4,
    elbowObservedHeadCollisionRejectPenetration: 0.12,
    elbowInferenceOutsideWeight: 0.35,
    elbowInferenceDeepInsideThreshold: 0.35,
    elbowInferenceDeepInsideWeight: 3,
    elbowInferencePoleMaxAgeMs: 2_000,
  },
  wristEvidence: {
    // Cần hai observation Hand liên tiếp ở pipeline 11–30 FPS trước khi Hand được quyền thay
    // Pose wrist; trong lúc chờ, output cũ được giữ bởi temporal layer.
    handEnterConfirmMs: 50,
    handMaxAgeMs: 200,
    poseHandMaxDeltaMs: 150,
    cadenceEwmaAlpha: 0.2,
    graceCadenceMultiplier: 1.5,
    minimumGraceMs: 80,
    maximumGraceMs: 220,
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
  gesture: {
    classifier: DEFAULT_GESTURE_CLASSIFIER_CONFIG,
    temporal: DEFAULT_GESTURE_TEMPORAL_CONFIG,
    pose: DEFAULT_FINGER_POSE_TEMPORAL_CONFIG,
  },
  continuousFinger:{holdMs:80,predictionEndMs:180,safeReturnEndMs:450,maxPredictionRadiansPerMs:.008,imageExtensionFacingThreshold:.55,observationDeadband:{extendedRadians:1.5*Math.PI/180,curledRadians:2*Math.PI/180,fullCurlRadians:70*Math.PI/180},measurementValidation:{windowSize:3,minimumConfidence:.35,boneLengthToleranceRatio:.35},filter:{minCutoff:1.4,beta:.08,derivativeCutoff:1},humanObservationLimits:{mcp:{min:-15*Math.PI/180,max:90*Math.PI/180},pip:{min:-5*Math.PI/180,max:105*Math.PI/180},dip:{min:-5*Math.PI/180,max:85*Math.PI/180},thumb:{min:-20*Math.PI/180,max:80*Math.PI/180},abduction:{min:-25*Math.PI/180,max:25*Math.PI/180},thumbAbduction:{min:-70*Math.PI/180,max:70*Math.PI/180},thumbOpposition:{min:-30*Math.PI/180,max:30*Math.PI/180}}},
};
