import { Vector3 } from "three";
import type { ArmSide } from "./avatarMotionDiagnostics";
import type { Vector3Data } from "./avatarPoseTypes";

/**
 * Mức 2B — Việc 2: tính twist target THUẦN quanh forearm axis từ palm basis của Hand, hoàn
 * toàn tách biệt khỏi swing. Input là forearm axis đã có sẵn (từ armFrameSolver, KHÔNG tính
 * lại ở đây), palm basis (từ handPalmBasis.ts, Việc 2 Mức 2A) và một reference direction để
 * đo góc twist=0. Không tạo quaternion, không sửa jointRotations/armFrameSolver/temporal
 * state/VRM (AGENTS.md Mức 2B mục 9) — module này CHỈ trả một góc (radian) + metadata.
 */

export type HandForearmTwistRejectionReason =
  | "zero-length-axis"
  | "zero-length-palm-direction"
  | "zero-length-reference"
  | "non-finite"
  | "axis-not-unit"
  | "projection-degenerate"
  | "quality-too-low";

export type HandTwistPalmAxis = "across" | "forward" | "normal";

export interface HandForearmTwistConfig {
  /** Độ dài tối thiểu (sau chiếu lên mặt phẳng vuông góc forearm axis) để coi projection không suy biến. */
  minProjectedLength: number;
  /** Ngưỡng tối thiểu |axis| và |referenceDirection| trước khi normalize, để tránh chuẩn hoá vector gần-zero. */
  minInputVectorLength: number;
  /** Sai số cho phép khi kiểm tra forearmAxis đã là unit vector (|len - 1| phải nhỏ hơn giá trị này). */
  axisUnitTolerance: number;
  /** Ngưỡng quality tối thiểu (0..1) của palm basis nguồn để chấp nhận twist; dưới ngưỡng này bị reject dù hình học hợp lệ. */
  minPalmBasisQuality: number;
}

export const DEFAULT_HAND_FOREARM_TWIST_CONFIG: HandForearmTwistConfig = {
  minProjectedLength: 1e-4,
  minInputVectorLength: 1e-4,
  axisUnitTolerance: 1e-3,
  minPalmBasisQuality: 0.15,
};

export interface HandForearmTwistInput {
  side: ArmSide;
  /** Trục forearm hiện có, ĐÃ là unit vector, lấy từ armFrameSolver — module này không tính lại. */
  forearmAxis: Vector3Data;
  /** Palm basis (Gram-Schmidt, từ handPalmBasis.ts) của cùng side, cùng frame. */
  palmBasis: { across: Vector3Data; forward: Vector3Data; normal: Vector3Data };
  /** Chất lượng hình học của palmBasis nguồn (imageGeometryQuality hoặc worldGeometryQuality), 0..1. */
  palmBasisQuality: number;
  /** Trục palm dùng làm "palm direction" để chiếu — cấu hình rõ ràng, không hard-code ngầm. */
  palmDirectionAxis: HandTwistPalmAxis;
  /**
   * Hướng tham chiếu cho twist = 0, trong CÙNG không gian với forearmAxis/palmBasis (image hoặc
   * world — caller quyết định, module này không biết và không giả định).
   */
  referenceDirection: Vector3Data;
  /** Dấu quy ước khi đo góc quanh forearmAxis: quyết định "twist dương" tương ứng chiều quay nào. Không hard-code ngầm theo side (yêu cầu #5). */
  positiveSign: 1 | -1;
}

export interface HandForearmTwistResult {
  accepted: boolean;
  /**
   * null khi accepted=false. Kết quả `atan2` — signed WRAPPED angle trong [-PI, PI], dấu theo
   * `positiveSign` của input. Đây KHÔNG phải giá trị liên tục qua biên ±PI (twist vật lý vượt
   * quá PI sẽ nhảy dấu ở đây); unwrap theo lịch sử thời gian là việc của temporal layer sau
   * (Mức 2B — Việc temporal twist), module thuần này không giữ state để làm điều đó.
   */
  twistRadians: number | null;
  /** Quality của kết quả: kế thừa palmBasisQuality đầu vào khi accepted, 0 khi reject. Module này không tự tạo tín hiệu quality mới ngoài việc truyền lại đầu vào. */
  quality: number;
  rejectionReason: HandForearmTwistRejectionReason | null;
  /**
   * Tỉ lệ `|palm direction chiếu lên mặt phẳng vuông góc axis| / |palm direction thô ban đầu|`,
   * trong [0,1] — KHÔNG phải độ dài tuyệt đối (đó phụ thuộc scale của `palmBasis` nguồn, không
   * mang ý nghĩa leverage một cách độc lập). 1 = palm direction vuông góc hoàn toàn với axis
   * (leverage tối đa); gần 0 = palm direction gần song song axis (leverage thấp, twist không
   * đáng tin dù palm geometry quality gốc cao) — dùng cho `handTwistConfidence.ts`.
   */
  palmProjectionRatio: number | null;
  /** Cùng công thức với `palmProjectionRatio` nhưng cho `referenceDirection` — tỉ lệ, độc lập với độ lớn (scale) mà caller chọn cho referenceDirection (yêu cầu #4, Mức 2B — Việc 3). */
  referenceProjectionRatio: number | null;
}

function toVector3(v: Vector3Data): Vector3 {
  return new Vector3(v.x, v.y, v.z);
}

function isFiniteVector(v: Vector3): boolean {
  return Number.isFinite(v.x) && Number.isFinite(v.y) && Number.isFinite(v.z);
}

function rejected(
  reason: HandForearmTwistRejectionReason,
  palmProjectionRatio: number | null = null,
  referenceProjectionRatio: number | null = null,
): HandForearmTwistResult {
  return { accepted: false, twistRadians: null, quality: 0, rejectionReason: reason, palmProjectionRatio, referenceProjectionRatio };
}

/** ratio = |projected| / |raw|, trong [0,1] — độc lập với scale của vector raw ban đầu (yêu cầu #4). raw đã biết != 0 tại điểm gọi (đã qua check zero-length phía trên). */
function projectionRatio(projectedLength: number, rawLength: number): number {
  if (rawLength <= 0) return 0;
  return Math.max(0, Math.min(1, projectedLength / rawLength));
}

/**
 * palmDirectionAxis chọn TRỤC nào của palm basis được coi là "palm direction" cần chiếu —
 * caller (Việc sau, khi wire vào processor) quyết định trục nào phù hợp convention thật, xác
 * nhận bằng webcam. Module này không tự suy ra hay mặc định ngầm (yêu cầu #5).
 */
function selectPalmDirection(palmBasis: HandForearmTwistInput["palmBasis"], axis: HandTwistPalmAxis): Vector3Data {
  return palmBasis[axis];
}

export function computeHandForearmTwist(
  input: HandForearmTwistInput,
  config: HandForearmTwistConfig = DEFAULT_HAND_FOREARM_TWIST_CONFIG,
): HandForearmTwistResult {
  const rawAxis = toVector3(input.forearmAxis);
  const rawPalmDirSource = selectPalmDirection(input.palmBasis, input.palmDirectionAxis);
  const rawPalmDir = toVector3(rawPalmDirSource);
  const rawReference = toVector3(input.referenceDirection);

  if (!isFiniteVector(rawAxis) || !isFiniteVector(rawPalmDir) || !isFiniteVector(rawReference) || !Number.isFinite(input.palmBasisQuality)) {
    return rejected("non-finite");
  }

  if (rawAxis.length() < config.minInputVectorLength) return rejected("zero-length-axis");
  if (rawPalmDir.length() < config.minInputVectorLength) return rejected("zero-length-palm-direction");
  if (rawReference.length() < config.minInputVectorLength) return rejected("zero-length-reference");

  // forearmAxis phải đã là unit vector (hợp đồng input #1) — kiểm tra bằng dung sai
  // (`axisUnitTolerance`), KHÔNG so sánh float tuyệt đối, vì |axis| luôn có sai số làm tròn dù
  // caller tính đúng. Kiểm tra thay vì tự normalize để phát hiện sớm nếu caller truyền sai giá
  // trị, không âm thầm sửa dữ liệu người gọi.
  const axisLength = rawAxis.length();
  if (Math.abs(axisLength - 1) > config.axisUnitTolerance) return rejected("axis-not-unit");
  const axis = rawAxis.clone().normalize();

  // Chiếu palm direction và reference direction lên mặt phẳng vuông góc forearm axis (yêu cầu
  // #2): khử thành phần dọc theo axis khỏi mỗi vector trước khi đo góc, để swing (nghiêng
  // forearm axis) không lẫn vào twist (yêu cầu #4 — Hand chỉ cung cấp twist).
  const palmProjected = rawPalmDir.clone().addScaledVector(axis, -rawPalmDir.dot(axis));
  const referenceProjected = rawReference.clone().addScaledVector(axis, -rawReference.dot(axis));

  if (!isFiniteVector(palmProjected) || !isFiniteVector(referenceProjected)) return rejected("non-finite");
  const palmProjectionLength = palmProjected.length();
  const referenceProjectionLength = referenceProjected.length();
  // ratio tính trên độ dài RAW (trước chiếu), không phải sau normalize — phản ánh đúng leverage
  // hình học độc lập với scale của palmBasis/referenceDirection do caller chọn (yêu cầu #4).
  const palmProjectionRatio = projectionRatio(palmProjectionLength, rawPalmDir.length());
  const referenceProjectionRatio = projectionRatio(referenceProjectionLength, rawReference.length());
  if (palmProjectionLength < config.minProjectedLength || referenceProjectionLength < config.minProjectedLength) {
    return rejected("projection-degenerate", palmProjectionRatio, referenceProjectionRatio);
  }
  const palmDir = palmProjected.normalize();
  const refDir = referenceProjected.normalize();

  // Signed angle quanh axis: atan2(cross·axis, dot) trả WRAPPED angle trong [-PI, PI] — xem
  // ghi chú `twistRadians` trên HandForearmTwistResult về giới hạn liên tục qua biên.
  const cross = new Vector3().crossVectors(refDir, palmDir);
  const sinComponent = cross.dot(axis);
  const cosComponent = refDir.dot(palmDir);
  const rawAngle = Math.atan2(sinComponent, cosComponent);
  if (!Number.isFinite(rawAngle)) return rejected("non-finite", palmProjectionRatio, referenceProjectionRatio);

  const twistRadians = input.positiveSign * rawAngle;

  if (input.palmBasisQuality < config.minPalmBasisQuality) {
    return rejected("quality-too-low", palmProjectionRatio, referenceProjectionRatio);
  }

  return {
    accepted: true,
    twistRadians,
    quality: input.palmBasisQuality,
    rejectionReason: null,
    palmProjectionRatio,
    referenceProjectionRatio,
  };
}
