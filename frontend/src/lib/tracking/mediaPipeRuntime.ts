import {
  FaceLandmarker,
  FilesetResolver,
  HandLandmarker,
  PoseLandmarker,
  type FaceLandmarkerResult,
  type HandLandmarkerResult,
  type PoseLandmarkerResult,
} from "@mediapipe/tasks-vision";

export type ConfiguredDelegate = "GPU" | "CPU";
export type DelegateSelection = ConfiguredDelegate | "AUTO";
export type TrackingTaskName = "face" | "hands" | "pose";
export type TrackingTaskSelection = Record<TrackingTaskName, boolean>;
/**
 * `lite` sai số toạ độ z lớn hơn `full` rõ rệt. Vì hướng xương cánh tay dựng trực tiếp từ
 * world landmark, z nhiễu làm tay rung và lệch — nặng nhất khi tay hướng về phía camera.
 * `full` đổi lấy độ chính xác bằng thời gian suy luận, nên vẫn để chọn được và đo bằng
 * TrackingMetricsCollector trước khi chốt cho máy cấu hình thấp.
 */
export type PoseModelVariant = "lite" | "full";
export const DEFAULT_POSE_MODEL: PoseModelVariant = "full";

export interface TrackingLandmarkers {
  face?: Pick<FaceLandmarker, "detectForVideo" | "close">;
  hands?: Pick<HandLandmarker, "detectForVideo" | "close">;
  pose?: Pick<PoseLandmarker, "detectForVideo" | "close">;
}

export interface TrackingInferenceResults {
  face: FaceLandmarkerResult;
  hands: HandLandmarkerResult;
  pose: PoseLandmarkerResult;
}

export interface MediaPipeRuntimeDependencies {
  resolveFileset: (basePath: string) => ReturnType<typeof FilesetResolver.forVisionTasks>;
  createFace: typeof FaceLandmarker.createFromOptions;
  createHands: typeof HandLandmarker.createFromOptions;
  createPose: typeof PoseLandmarker.createFromOptions;
}

const defaultDependencies: MediaPipeRuntimeDependencies = {
  resolveFileset: (basePath) => FilesetResolver.forVisionTasks(basePath),
  createFace: FaceLandmarker.createFromOptions.bind(FaceLandmarker),
  createHands: HandLandmarker.createFromOptions.bind(HandLandmarker),
  createPose: PoseLandmarker.createFromOptions.bind(PoseLandmarker),
};

function publicAsset(path: string): string {
  return `${import.meta.env.BASE_URL}mediapipe/${path}`;
}

export class MediaPipeRuntime {
  private readonly dependencies: MediaPipeRuntimeDependencies;
  private readonly delegate: DelegateSelection;
  private readonly selection: TrackingTaskSelection;
  private readonly poseModel: PoseModelVariant;
  private landmarkers: TrackingLandmarkers | null = null;
  private initPromise: Promise<void> | null = null;
  private disposed = false;
  selectedDelegate: ConfiguredDelegate | null = null;

  constructor(
    dependencies: MediaPipeRuntimeDependencies = defaultDependencies,
    delegate: DelegateSelection = "AUTO",
    selection: TrackingTaskSelection = { face: true, hands: true, pose: true },
    poseModel: PoseModelVariant = DEFAULT_POSE_MODEL,
  ) {
    this.dependencies = dependencies;
    this.delegate = delegate;
    this.selection = selection;
    this.poseModel = poseModel;
  }

  get selectedPoseModel(): PoseModelVariant { return this.poseModel; }

  async initialize(): Promise<void> {
    if (this.disposed) throw new Error("MediaPipe runtime đã dispose.");
    if (this.landmarkers) return;
    if (!this.initPromise) {
      this.initPromise = this.initializeWithFallback().finally(() => { this.initPromise = null; });
    }
    return this.initPromise;
  }

  get tasks(): TrackingLandmarkers {
    if (!this.landmarkers) throw new Error("MediaPipe runtime chưa khởi tạo.");
    return this.landmarkers;
  }

  private async initializeWithFallback(): Promise<void> {
    const fileset = await this.dependencies.resolveFileset(publicAsset("wasm"));
    if (this.delegate !== "AUTO") {
      this.landmarkers = await this.createTasks(fileset, this.delegate);
      this.selectedDelegate = this.delegate;
      return;
    }
    try {
      this.landmarkers = await this.createTasks(fileset, "GPU");
      this.selectedDelegate = "GPU";
    } catch (gpuError) {
      try {
        this.landmarkers = await this.createTasks(fileset, "CPU");
        this.selectedDelegate = "CPU";
      } catch (cpuError) {
        throw new AggregateError([gpuError, cpuError], "Không thể khởi tạo MediaPipe bằng GPU hoặc CPU.");
      }
    }
  }

  private async createTasks(
    fileset: Awaited<ReturnType<typeof FilesetResolver.forVisionTasks>>,
    delegate: ConfiguredDelegate,
  ): Promise<TrackingLandmarkers> {
    const created: Array<{ close(): void }> = [];
    try {
      const result: TrackingLandmarkers = {};
      if (this.selection.face) {
      const face = await this.dependencies.createFace(fileset, {
        baseOptions: { modelAssetPath: publicAsset("models/face_landmarker.task"), delegate },
        runningMode: "VIDEO",
        numFaces: 1,
        outputFaceBlendshapes: true,
        outputFacialTransformationMatrixes: true,
      });
      created.push(face);
      result.face = face;
      }
      if (this.selection.hands) {
      const hands = await this.dependencies.createHands(fileset, {
        baseOptions: { modelAssetPath: publicAsset("models/hand_landmarker.task"), delegate },
        runningMode: "VIDEO",
        numHands: 2,
      });
      created.push(hands);
      result.hands = hands;
      }
      if (this.selection.pose) {
      const pose = await this.dependencies.createPose(fileset, {
        baseOptions: { modelAssetPath: publicAsset(`models/pose_landmarker_${this.poseModel}.task`), delegate },
        runningMode: "VIDEO",
        numPoses: 1,
        outputSegmentationMasks: false,
        // Nâng ngưỡng tracking so với mặc định 0.5: giữ landmark có độ tin cậy thấp khiến
        // solver dựng hướng xương từ toạ độ đoán mò, đúng lúc tay bị che hoặc chồng lên thân.
        // Thà để arm-frame reject và giữ tư thế hợp lệ gần nhất theo FR-09 còn hơn xoắn tay.
        minPoseDetectionConfidence: 0.6,
        minPosePresenceConfidence: 0.6,
        minTrackingConfidence: 0.6,
      });
      created.push(pose);
      result.pose = pose;
      }
      return result;
    } catch (error) {
      for (const task of created.reverse()) task.close();
      throw error;
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.landmarkers?.face?.close();
    this.landmarkers?.hands?.close();
    this.landmarkers?.pose?.close();
    this.landmarkers = null;
    this.selectedDelegate = null;
  }
}
