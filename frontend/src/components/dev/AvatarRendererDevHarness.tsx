import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Group } from "three";
import { AvatarCanvas } from "../avatar/AvatarCanvas";
import { AvatarMotionProcessor, type ShoulderVerticalDiagnosticSnapshot,type TorsoLeanDiagnosticSnapshot } from "../../lib/avatar-motion/avatarMotionProcessor";
import type { AvatarPosePacket } from "../../lib/avatar-motion/avatarPoseTypes";
import type { AvatarMotionDiagnosticSnapshot } from "../../lib/avatar-motion/avatarMotionDiagnostics";
import type { FacialNeutralCalibrationSnapshot } from "../../lib/avatar-motion/facialNeutralCalibration";
import type { EyeBrowExpressionSnapshot } from "../../lib/avatar-motion/eyeBrowExpression";
import type { MouthExpressionSnapshot } from "../../lib/avatar-motion/mouthExpression";
import type { MouthPipelineTelemetrySnapshot } from "../../lib/avatar-motion/mouthPipelineTelemetry";
import type { FacialExpressionDynamicsSnapshot } from "../../lib/avatar-motion/facialExpressionDynamics";
import type { GazeDiagnostics } from "../../lib/avatar-motion/gazeSolver";
import type { GazeEyelidDiagnostic } from "../../lib/avatar-motion/gazeEyelidCoupling";
import type { GazeMetricsSnapshot } from "../../lib/avatar-motion/gazeMetrics";
import type { FingerRigProfile } from "../../lib/avatar-motion/fingerRig";
import type { GesturePoseLabel } from "../../lib/avatar-motion/gestureClassifier";
import type { AppliedFacialExpressionDiagnostic, AppliedShoulderTranslationDiagnostic, AvatarRenderer } from "../../lib/avatar-renderer/avatarRenderer";
import type { AppliedGazeDiagnostic, GazeCapability } from "../../lib/avatar-renderer/gazeCapabilityAdapter";
import { clearDiagnosticHelpers, createDiagnosticHelpers, elbowPlaneNormal, updateDiagnosticHelpers } from "../../lib/avatar-renderer/avatarDiagnostics";
import type { ModelCapabilityReport } from "../../lib/avatar-renderer/modelTypes";
import type { RendererMetricsSnapshot } from "../../lib/avatar-renderer/rendererMetrics";
import { isCurrentModelLoadRequest } from "../../lib/avatar-renderer/modelLoader";
import type { RawTrackingFrameV1 } from "../../lib/tracking/rawTrackingTypes";
import type { TrackingMetricsSnapshot } from "../../lib/tracking/trackingMetrics";
import { useTracking } from "../../lib/tracking/useTracking";
import { DEFAULT_POSE_MODEL, type PoseModelVariant } from "../../lib/tracking/mediaPipeRuntime";
import { GestureFixtureCollector, reportFixtureGaps, type FixtureGapReport, type GestureFixtureCondition, type GestureFixtureDistance, type GestureFixtureOcclusion, type GestureFixtureOrientation, type GestureFixturePose, type GestureFixtureSplit } from "../../lib/avatar-motion/gestureFixture";
import { DEFAULT_DEV_AVATAR_MODEL_ID, DEV_AVATAR_MODELS, getDevAvatarModel, type DevAvatarModel } from "./devAvatarModels";
import { AudioQualificationPanel } from "./AudioQualificationPanel";
import type { UpperBodyCalibrationSnapshot } from "../../lib/avatar-motion/upperBodyCalibration";
import type { LifeMotionSnapshot } from "../../lib/avatar-motion/upperBodyLifeMotion";
import type { UpperBodyMetricSnapshot } from "../../lib/avatar-motion/upperBodyMetrics";
import "./avatarRendererDevHarness.css";

const DIAGNOSTIC_CONVERSION = "current" as const;
const number = (value: number | null | undefined, digits = 1) => value === null || value === undefined || !Number.isFinite(value) ? "—" : value.toFixed(digits);
const degrees = (value: number | null | undefined) => value === null || value === undefined || !Number.isFinite(value) ? "—" : `${(value * 180 / Math.PI).toFixed(1)}°`;
const vector = (value: {x:number;y:number;z:number}|null|undefined) => value ? `${value.x.toFixed(2)}, ${value.y.toFixed(2)}, ${value.z.toFixed(2)}` : "—";
const quaternion = (value: {x:number;y:number;z:number;w:number}|null|undefined) => value ? `${value.x.toFixed(2)}, ${value.y.toFixed(2)}, ${value.z.toFixed(2)}, ${value.w.toFixed(2)}` : "—";

export default function AvatarRendererDevHarness() {
  const videoRef = useRef<HTMLVideoElement>(null); const rendererRef = useRef<AvatarRenderer | null>(null); const helpersRef = useRef<Group | null>(null);
  const modelLoadRequestRef = useRef(0);
  const freezeTimerRef = useRef<number | null>(null);
  const processorRef = useRef(new AvatarMotionProcessor({continuousFingerEnabled:true})); const latestPacket = useRef<AvatarPosePacket | null>(null); const latestRaw = useRef<RawTrackingFrameV1 | null>(null); const frozenRaw = useRef<RawTrackingFrameV1 | null>(null);
  const [filtered, setFiltered] = useState(true); const [constraints, setConstraints] = useState(true); const [smoothing, setSmoothing] = useState(true);
  const [handTwistEnabled, setHandTwistEnabled] = useState(true);
  // Phase 3B.3 — mặc định TẮT. Bật là hành động thử nghiệm có chủ đích của người test.
  const [gestureEnabled, setGestureEnabled] = useState(false);
  // AR6 đang là pipeline cần nghiệm thu trên trang này: bật ngay từ frame đầu để không vô tình test
  // classifier/preset legacy rồi tưởng đó là continuous tracking.
  const [continuousFingerEnabled,setContinuousFingerEnabled]=useState(true);
  const [continuousFingerDiagnostics,setContinuousFingerDiagnostics]=useState(()=>processorRef.current.getContinuousFingerDiagnostics());
  const fingerTraceActiveRef=useRef(false);
  const fingerTraceRef=useRef<Array<Record<string,unknown>>>([]);
  const [fingerTraceActive,setFingerTraceActive]=useState(false);
  const [fingerTraceCount,setFingerTraceCount]=useState(0);
  const [fingerRig, setFingerRig] = useState<FingerRigProfile | null>(null);
  const [gesturePoses, setGesturePoses] = useState<Record<"left" | "right", GesturePoseLabel>>({ left: "rest", right: "rest" });
  const [helpers, setHelpers] = useState(false); const [frozen, setFrozen] = useState(false);
  const [sampleName, setSampleName] = useState("live"); const [frozenSequence, setFrozenSequence] = useState(0);
  const [freezeCountdown, setFreezeCountdown] = useState<number | null>(null);
  const [simulatedLoss, setSimulatedLoss] = useState(false); const [trackingRunning, setTrackingRunning] = useState(false); const [rendererRunning, setRendererRunning] = useState(true);
  const [poseModel, setPoseModel] = useState<PoseModelVariant>(DEFAULT_POSE_MODEL);
  const [avatarModelId, setAvatarModelId] = useState(DEFAULT_DEV_AVATAR_MODEL_ID);
  const [zoom, setZoom] = useState(1); const [verticalOffset, setVerticalOffset] = useState(0);
  const [error, setError] = useState<string | null>(null); const [capability, setCapability] = useState<ModelCapabilityReport | null>(null); const [packet, setPacket] = useState<AvatarPosePacket | null>(null);
  const [facialCalibration, setFacialCalibration] = useState<FacialNeutralCalibrationSnapshot>(() => processorRef.current.getFacialCalibration());
  const [upperBodyCalibration, setUpperBodyCalibration] = useState<UpperBodyCalibrationSnapshot>(() => processorRef.current.getUpperBodyCalibration());
  const [upperBodyLife, setUpperBodyLife] = useState<LifeMotionSnapshot>(() => processorRef.current.getUpperBodyLifeMotion());
  const [upperBodyMetrics, setUpperBodyMetrics] = useState<UpperBodyMetricSnapshot>(() => processorRef.current.getUpperBodyMetrics());
  const [shoulderVertical, setShoulderVertical] = useState<ShoulderVerticalDiagnosticSnapshot>(() => processorRef.current.getShoulderVerticalDiagnostics());
  const [torsoLean,setTorsoLean]=useState<TorsoLeanDiagnosticSnapshot>(()=>processorRef.current.getTorsoLeanDiagnostics());
  const [appliedShoulderTranslation, setAppliedShoulderTranslation] = useState<AppliedShoulderTranslationDiagnostic | null>(null);
  const [eyeBrowExpressions, setEyeBrowExpressions] = useState<EyeBrowExpressionSnapshot>(() => processorRef.current.getEyeBrowExpressions());
  const [mouthExpressions, setMouthExpressions] = useState<MouthExpressionSnapshot>(() => processorRef.current.getMouthExpressions());
  const [facialDynamics, setFacialDynamics] = useState<FacialExpressionDynamicsSnapshot>(() => processorRef.current.getFacialDynamics());
  const [mouthTelemetry, setMouthTelemetry] = useState<MouthPipelineTelemetrySnapshot>(() => processorRef.current.getMouthPipelineTelemetry());
  const [gazeDiagnostics, setGazeDiagnostics] = useState<GazeDiagnostics>(() => processorRef.current.getGazeDiagnostics());
  const [gazeMetrics, setGazeMetrics] = useState<GazeMetricsSnapshot>(() => processorRef.current.getGazeMetrics());
  const [gazeEyelidDiagnostic, setGazeEyelidDiagnostic] = useState<GazeEyelidDiagnostic>(() => processorRef.current.getGazeEyelidDiagnostic());
  const [gazeMode, setGazeMode] = useState<"faithful" | "cinematic">("faithful");
  const [gazeAttention, setGazeAttention] = useState(0);
  const [gazeCapability, setGazeCapability] = useState<GazeCapability | null>(null);
  const [appliedGaze, setAppliedGaze] = useState<AppliedGazeDiagnostic | null>(null);
  const [appliedFacialExpressions, setAppliedFacialExpressions] = useState<Readonly<Record<string, AppliedFacialExpressionDiagnostic>>>({});
  const [planeNormals, setPlaneNormals] = useState<Record<string, unknown>>({});
  const [motionDiagnostics, setMotionDiagnostics] = useState<AvatarMotionDiagnosticSnapshot | null>(null);
  const [rendererMetrics, setRendererMetrics] = useState<RendererMetricsSnapshot | null>(null); const [trackingMetrics, setTrackingMetrics] = useState<TrackingMetricsSnapshot | null>(null);
  const [modelLoading, setModelLoading] = useState(false);
  // Phase 3B.3 Việc 0: thu fixture landmark thật. Chỉ thu và xuất; chưa có classifier nào đọc.
  const fixtureRef = useRef(new GestureFixtureCollector());
  const fixtureAutoTimerRef = useRef<number | null>(null);
  const fixtureAutoStateRef = useRef<{ baseCondition: Omit<GestureFixtureCondition, "split">; nextSplitIndex: number; lastHandSampledAtMs: number | null } | null>(null);
  const [fixtureSide, setFixtureSide] = useState<GestureFixtureCondition["side"]>("left");
  const [fixturePose, setFixturePose] = useState<GestureFixturePose>("open");
  const [fixtureOrientation, setFixtureOrientation] = useState<GestureFixtureOrientation>("palm-to-camera");
  const [fixtureDistance, setFixtureDistance] = useState<GestureFixtureDistance>("normal");
  const [fixtureOcclusion, setFixtureOcclusion] = useState<GestureFixtureOcclusion>("none");
  const [fixtureSplit, setFixtureSplit] = useState<GestureFixtureSplit>("calibration");
  const [fixtureCount, setFixtureCount] = useState(0);
  const [fixtureGaps, setFixtureGaps] = useState<FixtureGapReport>(() => reportFixtureGaps([]));
  const [fixtureStatus, setFixtureStatus] = useState<string>("Chưa thu mẫu nào.");

  const processInput = useCallback((frame: RawTrackingFrameV1) => {
    const input = simulatedLoss ? { ...frame, face: { ...frame.face, state: "lost" as const }, leftHand: { ...frame.leftHand, state: "lost" as const }, rightHand: { ...frame.rightHand, state: "lost" as const }, pose: { ...frame.pose, state: "lost" as const } } : frame;
    const next = processorRef.current.process(input); latestPacket.current = next; rendererRef.current?.applyPose(next);
    if(fingerTraceActiveRef.current&&fingerTraceRef.current.length<300){
      const entry={capturedAtMs:performance.now(),frameTimestampMs:frame.frameTimestampMs,video:{width:frame.videoWidth,height:frame.videoHeight},handSamples:{left:frame.leftHand,right:frame.rightHand},rawHands:frame.rawHands,poseWrists:{left:frame.pose.landmarks?.[15]??null,right:frame.pose.landmarks?.[16]??null},handMotion:next.handMotion??null,continuousFinger:processorRef.current.getContinuousFingerDiagnostics(),jointRotations:next.jointRotations};
      fingerTraceRef.current.push(entry);
      if(fingerTraceRef.current.length%5===0)setFingerTraceCount(fingerTraceRef.current.length);
      if(fingerTraceRef.current.length>=300){fingerTraceActiveRef.current=false;setFingerTraceActive(false);setFingerTraceCount(300);}
    }
  }, [simulatedLoss]);
  const startFingerTrace=useCallback(()=>{fingerTraceRef.current=[];fingerTraceActiveRef.current=true;setFingerTraceCount(0);setFingerTraceActive(true);},[]);
  const stopFingerTrace=useCallback(()=>{fingerTraceActiveRef.current=false;setFingerTraceActive(false);setFingerTraceCount(fingerTraceRef.current.length);},[]);
  const downloadFingerTrace=useCallback(()=>{
    const payload={version:1,createdAt:new Date().toISOString(),avatarModelId,fingerRig,frames:fingerTraceRef.current};
    const url=URL.createObjectURL(new Blob([JSON.stringify(payload)],{type:"application/json"}));
    const anchor=document.createElement("a");anchor.href=url;anchor.download=`ar6-finger-trace-${Date.now()}.json`;anchor.click();window.setTimeout(()=>URL.revokeObjectURL(url),1000);
  },[avatarModelId,fingerRig]);
  const onFrame = useCallback((frame: RawTrackingFrameV1) => { if (frozenRaw.current) return; latestRaw.current = frame; processInput(frame); }, [processInput]);
  const onMetrics = useCallback((value: TrackingMetricsSnapshot) => { setTrackingMetrics(value); }, []);
  const onError = useCallback((reason: unknown) => setError(reason instanceof Error ? reason.message : "Tracking error"), []);
  // Đổi model pose phải dựng lại pipeline (useTracking dispose theo options), nên tracking sẽ
  // dừng khi chuyển lite↔full — bấm "Start tracking" lại để đo biến thể mới.
  const trackingOptions = useMemo(() => ({ profile: "full-rate" as const, resolution: "720p" as const, delegate: "GPU" as const, tasks: { face: true, hands: true, pose: true }, poseModel, onFrame, onMetrics, onError }), [poseModel, onFrame, onMetrics, onError]);
  const tracking = useTracking(trackingOptions);

  useEffect(() => { processorRef.current.setFiltered(filtered); }, [filtered]);
  useEffect(() => { processorRef.current.setConstraints(constraints); }, [constraints]);
  useEffect(() => { processorRef.current.setHandTwistEnabled(handTwistEnabled); }, [handTwistEnabled]);
  useEffect(() => { processorRef.current.setGestureEnabled(gestureEnabled); }, [gestureEnabled]);
  useEffect(()=>{processorRef.current.setContinuousFingerEnabled(continuousFingerEnabled);},[continuousFingerEnabled]);
  useEffect(()=>{if(!continuousFingerEnabled)return;const timer=window.setInterval(()=>setContinuousFingerDiagnostics(processorRef.current.getContinuousFingerDiagnostics()),100);return()=>window.clearInterval(timer);},[continuousFingerEnabled]);
  useEffect(() => { processorRef.current.setGazeMode(gazeMode); }, [gazeMode]);
  useEffect(() => { processorRef.current.setGazeAttentionStrength(gazeAttention); }, [gazeAttention]);
  // Nhãn cử chỉ cần nhịp nhanh hơn panel chung (400ms): ở 400ms người test không thấy được nhãn
  // đổi lúc chuyển tư thế, nên không phân biệt được "nhận sai" với "nhận chậm".
  useEffect(() => {
    if (!gestureEnabled) return;
    const timer = window.setInterval(() => setGesturePoses(processorRef.current.getGesturePoses()), 100);
    return () => window.clearInterval(timer);
  }, [gestureEnabled]);
  useEffect(() => { rendererRef.current?.setSmoothing(smoothing); }, [smoothing]);
  useEffect(() => { rendererRef.current?.setZoom(zoom); }, [zoom]);
  useEffect(() => { rendererRef.current?.setVerticalOffset(verticalOffset); }, [verticalOffset]);
  useEffect(() => {
    const timer = window.setInterval(() => {
      const renderer = rendererRef.current; const raw = frozenRaw.current ?? latestRaw.current; setPacket(latestPacket.current); setMotionDiagnostics(processorRef.current.getLastDiagnostics()); setFacialCalibration(processorRef.current.getFacialCalibration()); setUpperBodyCalibration(processorRef.current.getUpperBodyCalibration()); setUpperBodyLife(processorRef.current.getUpperBodyLifeMotion()); setUpperBodyMetrics(processorRef.current.getUpperBodyMetrics()); setShoulderVertical(processorRef.current.getShoulderVerticalDiagnostics());setTorsoLean(processorRef.current.getTorsoLeanDiagnostics()); setEyeBrowExpressions(processorRef.current.getEyeBrowExpressions()); setMouthExpressions(processorRef.current.getMouthExpressions()); setFacialDynamics(processorRef.current.getFacialDynamics()); setMouthTelemetry(processorRef.current.getMouthPipelineTelemetry()); setGazeDiagnostics(processorRef.current.getGazeDiagnostics()); setGazeMetrics(processorRef.current.getGazeMetrics()); setGazeEyelidDiagnostic(processorRef.current.getGazeEyelidDiagnostic()); if (!renderer) return;
      setAppliedFacialExpressions(renderer.getAppliedFacialExpressions());
      setAppliedShoulderTranslation(renderer.getAppliedShoulderTranslation());
      setGazeCapability(renderer.getGazeCapability()); setAppliedGaze(renderer.getAppliedGaze());
      setRendererMetrics(renderer.getMetrics()); const model = renderer.getDiagnosticModel(); if (!model) return;
      if (raw?.pose.worldLandmarks) { setPlaneNormals({ left: elbowPlaneNormal(raw.pose.worldLandmarks, "left", DIAGNOSTIC_CONVERSION), right: elbowPlaneNormal(raw.pose.worldLandmarks, "right", DIAGNOSTIC_CONVERSION) }); if (helpersRef.current) updateDiagnosticHelpers(helpersRef.current, model.bones, raw.pose.worldLandmarks, DIAGNOSTIC_CONVERSION); }
    }, 400); return () => window.clearInterval(timer);
  }, []);
  useEffect(() => () => { if (freezeTimerRef.current !== null) window.clearInterval(freezeTimerRef.current); stopAutoCapture(); if (helpersRef.current) clearDiagnosticHelpers(helpersRef.current); processorRef.current.dispose(); }, []);
  useEffect(() => { const renderer = rendererRef.current; const model = renderer?.getDiagnosticModel(); if (!model) return; if (helpers && !helpersRef.current) helpersRef.current = createDiagnosticHelpers(model.root, model.bones); if (!helpers && helpersRef.current) { clearDiagnosticHelpers(helpersRef.current); helpersRef.current = null; } }, [helpers, capability]);

  const resetModelMotionState = useCallback(() => {
    processorRef.current.setFingerRig(null);
    processorRef.current.setRigProfile(null);
    processorRef.current.setUpperBodyRigProfile(null);
    processorRef.current.setFacialModelFingerprint(null);
    processorRef.current.setGazeEyelidSupport(null);
    processorRef.current.reset();
    latestPacket.current = null;
    setPacket(null);
    setMotionDiagnostics(null);
    setTorsoLean(processorRef.current.getTorsoLeanDiagnostics());
    setPlaneNormals({});
    setFingerRig(null);
    setCapability(null);
    setGesturePoses({ left: "rest", right: "rest" });
    setMouthExpressions(processorRef.current.getMouthExpressions());
    setFacialDynamics(processorRef.current.getFacialDynamics());
    setMouthTelemetry(processorRef.current.getMouthPipelineTelemetry());
    setUpperBodyCalibration(processorRef.current.getUpperBodyCalibration());
    setUpperBodyLife(processorRef.current.getUpperBodyLifeMotion());
    setUpperBodyMetrics(processorRef.current.getUpperBodyMetrics());
    setShoulderVertical(processorRef.current.getShoulderVerticalDiagnostics()); setAppliedShoulderTranslation(null);
    setAppliedFacialExpressions({});
    setGazeCapability(null); setAppliedGaze(null); setGazeDiagnostics(processorRef.current.getGazeDiagnostics()); setGazeMetrics(processorRef.current.getGazeMetrics()); setGazeEyelidDiagnostic(processorRef.current.getGazeEyelidDiagnostic());
  }, []);

  const loadRendererModel = useCallback(async (renderer: AvatarRenderer, model: DevAvatarModel) => {
    const requestId = ++modelLoadRequestRef.current;
    setModelLoading(true);
    setError(null);
    resetModelMotionState();
    if (helpersRef.current) { clearDiagnosticHelpers(helpersRef.current); helpersRef.current = null; }
    try {
      const report = await renderer.loadModel(model.url, { licenseStatus: "unknown" });
      if (!report || !isCurrentModelLoadRequest(rendererRef.current, renderer, modelLoadRequestRef.current, requestId)) return;
      const rigProfile = renderer.getRigProfile();
      processorRef.current.setUpperBodyRigProfile(renderer.getUpperBodyRigProfile());
      processorRef.current.setFacialModelFingerprint(renderer.getFacialCapability()?.modelFingerprint ?? null);
      processorRef.current.setGazeEyelidSupport(renderer.getGazeEyelidSupport());
      setGazeCapability(renderer.getGazeCapability());
      setCapability(report);
      if (report.unsupportedFeatures.length > 0) {
        const missingBones = Object.entries(report.requiredBones).filter(([, available]) => !available).map(([bone]) => bone);
        const boneDetail = missingBones.length > 0 ? ` Thiếu bone bắt buộc: ${missingBones.join(", ")}.` : "";
        setError(`${model.label} có capability blocker: ${report.unsupportedFeatures.join(" ")}${boneDetail}`);
      }
      // Phase 3B.3: rig ngón độc lập với arm rig profile — gán trước để model thiếu arm profile
      // vẫn báo đúng capability ngón trên panel.
      const nextFingerRig = renderer.getFingerRig();
      processorRef.current.setFingerRig(nextFingerRig);
      setFingerRig(nextFingerRig);
      if (!rigProfile) {
        processorRef.current.setRigProfile(null);
        setError(`${model.label} đã tải nhưng không tạo được normalized arm rig profile; face vẫn có thể chạy nhưng tay bị vô hiệu hóa.`);
        return;
      }
      processorRef.current.setRigProfile(rigProfile);
    } catch (reason) {
      if (isCurrentModelLoadRequest(rendererRef.current, renderer, modelLoadRequestRef.current, requestId)) {
        setError(`Model blocker (${model.label}): ${reason instanceof Error ? reason.message : String(reason)}`);
      }
    } finally {
      if (isCurrentModelLoadRequest(rendererRef.current, renderer, modelLoadRequestRef.current, requestId)) setModelLoading(false);
    }
  }, [resetModelMotionState]);
  const attachRenderer = useCallback((renderer: AvatarRenderer) => {
    rendererRef.current = renderer; renderer.setSmoothing(smoothing); renderer.setZoom(zoom); renderer.setVerticalOffset(verticalOffset);
    const model = getDevAvatarModel(avatarModelId);
    if (!model) { setError(`Không tìm thấy DEV avatar model: ${avatarModelId}`); return; }
    void loadRendererModel(renderer, model);
  }, [avatarModelId, loadRendererModel, smoothing, zoom, verticalOffset]);
  const detachRenderer = useCallback((renderer: AvatarRenderer) => {
    if (rendererRef.current !== renderer) return;
    ++modelLoadRequestRef.current;
    if (helpersRef.current) clearDiagnosticHelpers(helpersRef.current);
    helpersRef.current = null; rendererRef.current = null;
    // Cleanup có thể chạy khi React đang unmount; chỉ xóa state nội bộ, không set React state.
    processorRef.current.setFingerRig(null);
    processorRef.current.setRigProfile(null);
    processorRef.current.setUpperBodyRigProfile(null);
    processorRef.current.setGazeEyelidSupport(null);
    processorRef.current.reset();
    latestPacket.current = null;
  }, []);
  function selectAvatarModel(modelId: string) {
    const model = getDevAvatarModel(modelId);
    if (!model) { setError(`Không tìm thấy DEV avatar model: ${modelId}`); return; }
    setAvatarModelId(model.id);
    const renderer = rendererRef.current;
    if (renderer) void loadRendererModel(renderer, model);
  }
  function reloadModel() {
    const renderer = rendererRef.current; const model = getDevAvatarModel(avatarModelId);
    if (!renderer || !model || modelLoading) return;
    void loadRendererModel(renderer, model);
  }
  function refreshFixtureState() {
    setFixtureCount(fixtureRef.current.getSampleCount());
    setFixtureGaps(reportFixtureGaps(fixtureRef.current.getCoverage()));
  }
  function stopAutoCapture(status?: string) {
    if (fixtureAutoTimerRef.current !== null) window.clearInterval(fixtureAutoTimerRef.current);
    fixtureAutoTimerRef.current = null; fixtureAutoStateRef.current = null;
    if (status) setFixtureStatus(status);
  }
  function startAutoCapturePair() {
    const source = latestRaw.current;
    if (frozenRaw.current) { setFixtureStatus("Hãy bỏ Freeze current trước khi tự thu."); return; }
    if (!source) { setFixtureStatus("Chưa có frame live — bấm Start tracking trước."); return; }
    stopAutoCapture();
    const baseCondition: Omit<GestureFixtureCondition, "split"> = { side: fixtureSide, pose: fixturePose, orientation: fixtureOrientation, distance: fixtureDistance, occlusion: fixtureOcclusion };
    const state = { baseCondition, nextSplitIndex: 0, lastHandSampledAtMs: source.handSampledAtMs };
    fixtureAutoStateRef.current = state;
    setFixtureStatus("Đang chờ 2 sample mới: calibration rồi hold-out…");
    fixtureAutoTimerRef.current = window.setInterval(() => {
      const current = fixtureAutoStateRef.current;
      const live = latestRaw.current;
      if (!current || !live || !live.handSampledThisFrame || live.handSampledAtMs === null || live.handSampledAtMs === current.lastHandSampledAtMs) return;
      const split = current.nextSplitIndex === 0 ? "calibration" : "holdout";
      const result = fixtureRef.current.capture(live, { ...current.baseCondition, split }, performance.now());
      current.lastHandSampledAtMs = live.handSampledAtMs;
      if (result.sample) {
        current.nextSplitIndex += 1;
        refreshFixtureState();
        setFixtureStatus(`Tự thu ${split} #${result.sample.index}; đang chờ sample tiếp theo…`);
      } else if (result.rejectionReason === "no-candidate-for-side") {
        setFixtureStatus(`Đang chờ tay ${fixtureSide} rõ hơn…`);
      }
      if (current.nextSplitIndex >= 2) stopAutoCapture("Đã tự thu đủ calibration + hold-out cho pose này.");
    }, 100);
  }
  function captureFixture() {
    // Pose phải được tạo trước khi Freeze current. Khi FROZEN, đây là một detector sample bất biến;
    // không thể dùng lại nó cho split khác vì sẽ làm calibration/holdout bị trùng dữ liệu.
    const source = frozenRaw.current ?? latestRaw.current;
    if (!source) { setFixtureStatus("Chưa có frame nào — bấm Start tracking trước."); return; }
    const condition: GestureFixtureCondition = { side: fixtureSide, pose: fixturePose, orientation: fixtureOrientation, distance: fixtureDistance, occlusion: fixtureOcclusion, split: fixtureSplit };
    const result = fixtureRef.current.capture(source, condition, performance.now());
    if (result.rejectionReason) {
      const reason = result.rejectionReason === "no-hand-sample" ? "frame này không có sample tay mới"
        : result.rejectionReason === "no-candidate-for-side" ? `không thấy tay ${fixtureSide} trong frame`
        : result.rejectionReason === "duplicate-sample" ? "sample detector này đã thu rồi"
        : "landmark không đủ 21 điểm";
      setFixtureStatus(`Bỏ qua: ${reason}.`);
      return;
    }
    setFixtureStatus(`Đã thu mẫu #${result.sample!.index} (${fixtureSide}/${fixturePose}).`);
    refreshFixtureState();
  }
  function undoFixture() {
    setFixtureStatus(fixtureRef.current.undoLast() ? "Đã xoá mẫu gần nhất." : "Không còn mẫu để xoá.");
    refreshFixtureState();
  }
  function clearFixtures() {
    stopAutoCapture();
    fixtureRef.current.clear(); setFixtureStatus("Đã xoá toàn bộ mẫu."); refreshFixtureState();
  }
  function exportFixtures() {
    if (fixtureRef.current.getSampleCount() === 0) { setFixtureStatus("Chưa có mẫu để xuất."); return; }
    const file = fixtureRef.current.toFile(Date.now());
    const blob = new Blob([JSON.stringify(file, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url; link.download = `gesture-fixture-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
    link.click(); URL.revokeObjectURL(url);
    setFixtureStatus(`Đã xuất ${file.sampleCount} mẫu.`);
  }
  async function toggleTracking() { if (!tracking || !videoRef.current) return; if (trackingRunning) { tracking.stop(); setTrackingRunning(false); } else { setError(null); await tracking.start(videoRef.current); setTrackingRunning(true); } }
  function toggleRenderer() { const renderer = rendererRef.current; if (!renderer) return; if (rendererRunning) renderer.stop(); else renderer.start(); setRendererRunning(!rendererRunning); }
  function toggleFreeze() { if (frozenRaw.current) { frozenRaw.current = null; setFrozen(false); setSampleName("live"); return; } if (!latestRaw.current) return; frozenRaw.current = structuredClone(latestRaw.current); setFrozen(true); setFrozenSequence((value) => value + 1); setSampleName("webcam"); processInput(frozenRaw.current); }
  function freezeAfterCountdown() {
    if (frozenRaw.current || freezeTimerRef.current !== null || !latestRaw.current) return;
    let remaining = 5; setFreezeCountdown(remaining);
    freezeTimerRef.current = window.setInterval(() => {
      remaining -= 1; setFreezeCountdown(remaining);
      if (remaining > 0) return;
      window.clearInterval(freezeTimerRef.current!); freezeTimerRef.current = null; setFreezeCountdown(null); toggleFreeze();
    }, 1000);
  }
  const evidenceFrame = frozenRaw.current ?? latestRaw.current; const posePoints = evidenceFrame?.pose.worldLandmarks; const evidenceLandmarks = posePoints ? { leftEar: posePoints[7], rightEar: posePoints[8], leftShoulder: posePoints[11], rightShoulder: posePoints[12], leftElbow: posePoints[13], rightElbow: posePoints[14], leftWrist: posePoints[15], rightWrist: posePoints[16], leftHip: posePoints[23], rightHip: posePoints[24] } : null;
  return <main className="avatar-renderer-dev">
    <header><div><strong>DEV ONLY · LOCAL ONLY</strong><h1>P4-T10 Retargeting Diagnostics</h1></div><p>Không upload, capture hoặc lưu raw frame.</p></header>
    {error && <pre className="dev-error" role="alert">{error}</pre>}
    <section className="dev-controls">
      <button onClick={() => void toggleTracking()}>{trackingRunning ? "Stop tracking" : "Start tracking"}</button><button onClick={toggleRenderer}>{rendererRunning ? "Stop renderer" : "Start renderer"}</button><button onClick={reloadModel} disabled={modelLoading}>{modelLoading ? "Loading model…" : "Reload model"}</button><button onClick={() => { processorRef.current.calibrateFaceNeutral(); setFacialCalibration(processorRef.current.getFacialCalibration()); setUpperBodyCalibration(processorRef.current.getUpperBodyCalibration()); }}>Calibrate neutral face + upper body</button><span className={`facial-calibration-badge ${facialCalibration.state}`}>F1: {facialCalibration.state} · {facialCalibration.acceptedSamples}/{facialCalibration.requiredSamples} · {facialCalibration.collectionMode}</span><span className="eye-brow-badge">AR4: {upperBodyCalibration.state} · {upperBodyCalibration.acceptedPairs}/{upperBodyCalibration.requiredPairs} · {upperBodyCalibration.mode}</span><span className="eye-brow-badge">F2 blink L/R: {eyeBrowExpressions.blinkLeft.toFixed(2)}/{eyeBrowExpressions.blinkRight.toFixed(2)}{eyeBrowExpressions.unilateralCandidate ? ` · guard ${eyeBrowExpressions.unilateralCandidate}` : ""}</span>
      <button onClick={toggleFreeze} disabled={!frozen && !latestRaw.current}>{frozen ? "Unfreeze" : "Freeze current"}</button><button onClick={freezeAfterCountdown} disabled={frozen || freezeCountdown !== null || !latestRaw.current}>{freezeCountdown === null ? "Freeze in 5s" : `Freeze in ${freezeCountdown}s`}</button>
      <label><input type="checkbox" checked={filtered} onChange={(e) => setFiltered(e.target.checked)} /> Dynamics/filter</label><label><input type="checkbox" checked={constraints} onChange={(e) => setConstraints(e.target.checked)} /> Constraints</label><label><input type="checkbox" checked={handTwistEnabled} onChange={(e) => setHandTwistEnabled(e.target.checked)} /> Hand twist (2B-5)</label><label><input type="checkbox" checked={continuousFingerEnabled} onChange={(e)=>setContinuousFingerEnabled(e.target.checked)} /> Continuous fingers (AR6)</label><label><input type="checkbox" checked={gestureEnabled} disabled={continuousFingerEnabled} onChange={(e) => setGestureEnabled(e.target.checked)} /> Finger gesture (legacy)</label><label><input type="checkbox" checked={smoothing} onChange={(e) => setSmoothing(e.target.checked)} /> Bone smoothing</label><label><input type="checkbox" checked={helpers} onChange={(e) => setHelpers(e.target.checked)} /> Helpers</label><label><input type="checkbox" checked={simulatedLoss} onChange={(e) => setSimulatedLoss(e.target.checked)} /> Simulate loss</label>
      <label>Pose model <select value={poseModel} onChange={(e) => { if (trackingRunning) { tracking?.stop(); setTrackingRunning(false); } setPoseModel(e.target.value as PoseModelVariant); }}><option value="full">full (chính xác hơn)</option><option value="lite">lite (nhẹ hơn)</option></select></label>
      <label>Avatar model <select value={avatarModelId} onChange={(event) => selectAvatarModel(event.target.value)}>{DEV_AVATAR_MODELS.map((model) => <option key={model.id} value={model.id}>{model.label}</option>)}</select></label>
      <label>Zoom <input type="range" min="0.5" max="3" step="0.05" value={zoom} onChange={(e) => setZoom(Number(e.target.value))} /> {zoom.toFixed(2)}x</label>
      <label>Vị trí trên/dưới <input type="range" min="-0.5" max="0.5" step="0.01" value={verticalOffset} onChange={(e) => setVerticalOffset(Number(e.target.value))} /> {verticalOffset.toFixed(2)}</label>
      <label>Gaze mode <select value={gazeMode} onChange={(event) => setGazeMode(event.target.value as "faithful" | "cinematic")}><option value="faithful">faithful (mặc định)</option><option value="cinematic">cinematic (thử nghiệm)</option></select></label>
      <label>Camera attention <input type="range" min="0" max="1" step="0.05" value={gazeAttention} onChange={(event) => setGazeAttention(Number(event.target.value))} disabled={gazeMode !== "cinematic"} /> {gazeAttention.toFixed(2)}</label>
      <button onClick={() => { setZoom(1); setVerticalOffset(0); }}>Reset khung hình</button>
    </section>
    <section className="dev-stage"><AvatarCanvas onReady={attachRenderer} onDispose={detachRenderer} onError={(reason) => setError(`WebGL: ${reason.message}`)} options={{ smoothing, onContextLost: (reason) => setError(reason.message) }} /><div className="dev-camera-preview"><video ref={videoRef} muted playsInline />{!trackingRunning && <p>Camera chưa bật<br /><small>Bấm Start tracking để dùng webcam</small></p>}</div></section>
    <section className="dev-panels">
      <article><h2>Frozen evidence</h2><p>Mode: {frozen ? "FROZEN" : "LIVE"} · sample: <strong>{sampleName}</strong> · frozen #{frozenSequence}</p><p>Conversion: <strong>{DIAGNOSTIC_CONVERSION}</strong> · raw timestamp {number(evidenceFrame?.frameTimestampMs, 0)} · packet seq {packet?.sequence ?? "—"}</p><p>Solver {filtered ? "+dynamics/filter" : "raw"} · constraints {constraints ? "on" : "off"} · Hand twist {handTwistEnabled ? "on" : "Pose-only"} · bone smoothing {smoothing ? "on" : "off"}</p><pre>required world landmarks {JSON.stringify(evidenceLandmarks, null, 2)}</pre><pre>plane normal {JSON.stringify(planeNormals, null, 2)}</pre></article>
      <article><h2>Realtime</h2><p>Avatar: <strong>{getDevAvatarModel(avatarModelId)?.label ?? avatarModelId}</strong>{modelLoading ? " · đang tải…" : ""}</p><p>Tracking/Pipeline: {number(trackingMetrics?.cameraFps)} / {number(trackingMetrics?.pipelineFps)} FPS</p><p>Renderer: {number(rendererMetrics?.fps)} FPS · p95 {number(rendererMetrics?.frameTimeP95Ms)}ms</p><p>Processor→draw: {number(rendererMetrics?.processorInputToDrawMs)}ms</p>
        <p>Pose model: <strong>{trackingMetrics?.poseModel ?? `${poseModel} (chưa chạy)`}</strong> · delegate {trackingMetrics?.selectedDelegate ?? "—"}</p>
        <p>Pose inference: {number(trackingMetrics?.inferenceTimeMs.pose.average)}ms trung bình · p95 {number(trackingMetrics?.inferenceTimeMs.pose.p95)}ms · max {number(trackingMetrics?.inferenceTimeMs.pose.max)}ms</p></article>
      <article><h2>F1 neutral face</h2><p>Giữ mặt thư giãn khi calibration đang thu mẫu.</p><p>Trạng thái: <strong>{facialCalibration.state}</strong> · chế độ {facialCalibration.collectionMode} · nhận {facialCalibration.acceptedSamples}/{facialCalibration.requiredSamples} · bỏ {facialCalibration.rejectedSamples}</p><pre>{JSON.stringify(facialCalibration.baselines, null, 2)}</pre></article>
      <article><h2>AR4 upper body</h2>
        <p>Packet: <strong>V{packet?.version ?? "—"}</strong> · paired calibration <strong>{upperBodyCalibration.state}</strong> ({upperBodyCalibration.acceptedPairs}/{upperBodyCalibration.requiredPairs}) · mode <strong>{upperBodyCalibration.mode}</strong> · full torso pairs {upperBodyCalibration.acceptedFullTorsoPairs}</p>
        <p>Reject: skew {upperBodyCalibration.rejectedSkew} · quality {upperBodyCalibration.rejectedQuality} · missing face/shoulders {upperBodyCalibration.rejectedMissingRequired}</p>
        <p>Vertical image-space raw L/R <strong>{number(shoulderVertical.raw.left,2)} / {number(shoulderVertical.raw.right,2)}</strong> · filtered {number(shoulderVertical.filtered.left,2)} / {number(shoulderVertical.filtered.right,2)}</p>
        <p>Source L/R {shoulderVertical.source.left} / {shoulderVertical.source.right} · ear confidence {number(shoulderVertical.earGapConfidence.left,2)} / {number(shoulderVertical.earGapConfidence.right,2)} · lean common gain {number(shoulderVertical.commonMotionGain,2)} · state {shoulderVertical.state.left} / {shoulderVertical.state.right}</p>
        <p>Applied displacement L/R {number(appliedShoulderTranslation?.left.displacement,4)} / {number(appliedShoulderTranslation?.right.displacement,4)} · capability {appliedShoulderTranslation?.left.capability ?? "—"} / {appliedShoulderTranslation?.right.capability ?? "—"} · clamp {appliedShoulderTranslation?.left.clamped ? "L" : "—"}/{appliedShoulderTranslation?.right.clamped ? "R" : "—"}</p>
        <p>Lean {torsoLean.source} · raw/final {number(torsoLean.angle===null?null:torsoLean.angle*180/Math.PI,2)}°/{number(torsoLean.filteredAngle*180/Math.PI,2)}° · confidence {number(torsoLean.confidence,2)} · state {torsoLean.state}{torsoLean.limited?" · capped":""}</p>
        <p>Lean cues shoulder/face/mismatch/depth {number(torsoLean.cues.shoulderScale,3)} / {number(torsoLean.cues.faceScale,3)} / {number(torsoLean.cues.scaleMismatch,3)} / {number(torsoLean.cues.depth,3)} · penalties H/Y/R/S {number(torsoLean.penalties.head,2)}/{number(torsoLean.penalties.yaw,2)}/{number(torsoLean.penalties.roll,2)}/{number(torsoLean.penalties.shrug,2)}</p>
        <p>Life clock {number(upperBodyLife.continuousLifeTimeMs,0)} ms · breath {number(upperBodyLife.breathing,3)} · speechChest {number(upperBodyLife.speechChest*180/Math.PI,3)}° · sway yaw/roll {number(upperBodyLife.swayYaw*180/Math.PI,3)}°/{number(upperBodyLife.swayRoll*180/Math.PI,3)}°</p>
        <p>Head jitter raw/final/reduction {number(upperBodyMetrics.head.rawStandardDeviationDeg,3)}°/{number(upperBodyMetrics.head.finalStandardDeviationDeg,3)}°/{number(upperBodyMetrics.head.reductionRatio===null?null:upperBodyMetrics.head.reductionRatio*100,1)}% · torso {number(upperBodyMetrics.torso.rawStandardDeviationDeg,3)}°/{number(upperBodyMetrics.torso.finalStandardDeviationDeg,3)}°/{number(upperBodyMetrics.torso.reductionRatio===null?null:upperBodyMetrics.torso.reductionRatio*100,1)}%</p>
        <p>Solver avg/p95 {number(upperBodyMetrics.solverAverageMs,3)}/{number(upperBodyMetrics.solverP95Ms,3)} ms · aggregate clamp {upperBodyMetrics.aggregateClampCount} · invalid {upperBodyMetrics.invalidOutputs}</p>
        <pre>{JSON.stringify(packet?.version===2?{headRotation:packet.headRotation,shoulderMotion:packet.shoulderMotion,jointRotations:Object.fromEntries(Object.entries(packet.jointRotations).filter(([name])=>["hips","spine","chest","upperChest","neck","leftShoulder","rightShoulder"].includes(name)))}:{legacy:true},null,2)}</pre>
      </article>
      <article><h2>F2 eyes &amp; brows</h2><p>Blink L/R: <strong>{eyeBrowExpressions.blinkLeft.toFixed(2)} / {eyeBrowExpressions.blinkRight.toFixed(2)}</strong></p><p>Closed L/R: {eyeBrowExpressions.leftClosed ? "yes" : "no"} / {eyeBrowExpressions.rightClosed ? "yes" : "no"} · unilateral guard: {eyeBrowExpressions.unilateralCandidate ?? "none"}</p><p>Raw-profile brow down/up · eye wide: {eyeBrowExpressions.browDown.toFixed(2)} / {eyeBrowExpressions.browUp.toFixed(2)} · {eyeBrowExpressions.eyeWide.toFixed(2)}</p></article>
      <article><h2>AR3 Gaze</h2>
        <p>State/sample: <strong>{gazeDiagnostics.outputState}</strong> · {gazeDiagnostics.sampleDisposition} · quality {number(gazeDiagnostics.quality, 2)} · reject {gazeDiagnostics.rejectReason ?? "none"}</p>
        <p>Raw L H/V: {number(gazeDiagnostics.rawLeft?.horizontal, 2)} / {number(gazeDiagnostics.rawLeft?.vertical, 2)} · Raw R H/V: {number(gazeDiagnostics.rawRight?.horizontal, 2)} / {number(gazeDiagnostics.rawRight?.vertical, 2)}</p>
        <p>Fused yaw/pitch: <strong>{number(gazeDiagnostics.fused.yaw, 2)} / {number(gazeDiagnostics.fused.pitch, 2)}</strong> · final semantic {number(gazeDiagnostics.finalSemantic.yaw, 2)} / {number(gazeDiagnostics.finalSemantic.pitch, 2)} · clamp {gazeDiagnostics.clampApplied ? "yes" : "no"}</p>
        <p>Head yaw/pitch rad: {number(gazeDiagnostics.head?.yaw, 2)} / {number(gazeDiagnostics.head?.pitch, 2)}</p>
        <p>Adapter: <strong>{gazeCapability?.kind ?? "not-loaded"}</strong> · eyelid handled {gazeCapability?.handlesVerticalEyelid ? "yes" : "no"} · applied degrees {number(appliedGaze?.appliedDegrees?.yaw, 1)} / {number(appliedGaze?.appliedDegrees?.pitch, 1)} · reject {appliedGaze?.rejected ?? "none"}</p>
        <p>Mode: <strong>{gazeDiagnostics.mode}</strong> · blend {number(gazeDiagnostics.cinematic.blend, 2)} · attention bias {number(gazeDiagnostics.cinematic.attentionBias.yaw, 3)} / {number(gazeDiagnostics.cinematic.attentionBias.pitch, 3)} · saccade {number(gazeDiagnostics.cinematic.saccade.yaw, 3)} / {number(gazeDiagnostics.cinematic.saccade.pitch, 3)} · idle blink {number(gazeDiagnostics.cinematic.proceduralBlink, 2)}</p>
        <p>T02 eyelid: <strong>{gazeEyelidDiagnostic.status}</strong> · {gazeEyelidDiagnostic.reason ?? "none"} · outputs {Object.entries(gazeEyelidDiagnostic.outputs).map(([name, value]) => `${name}=${value.toFixed(2)}`).join(" · ") || "none"}</p>
        <p>T04 metrics: fresh/invalid {gazeMetrics.freshSampleCount}/{gazeMetrics.invalidSampleCount} · duplicate/reversed {gazeMetrics.duplicateSampleCount}/{gazeMetrics.reversedSampleCount} · clamp {gazeMetrics.clampHitCount} ({number(gazeMetrics.clampHitRatio * 100, 1)}%) · longest {number(gazeMetrics.longestClampDurationMs, 0)}ms</p>
        <p>Jitter p95 {number(gazeMetrics.semanticGazeJitterP95, 3)} · reacquire peak {number(gazeMetrics.semanticReacquirePeakDelta, 3)} · settle {number(gazeMetrics.semanticReacquireSettleTimeMs, 0)}ms · reacquire count {gazeMetrics.reacquireCount}</p>
      </article>
      <article><h2>F3 webcam mouth</h2>
        <p>Geometry J/C/O: <strong>{mouthExpressions.geometry.jawOpen.toFixed(2)} / {mouthExpressions.geometry.closure.toFixed(2)} / {mouthExpressions.geometry.visibleOpening.toFixed(2)}</strong></p>
        <p>Jaw source blendshape/landmark: <strong>{mouthExpressions.geometry.blendshapeJawOpen.toFixed(2)} / {mouthExpressions.geometry.landmarkJawOpen.toFixed(2)}</strong></p>
        <p>Round/width/activity: {mouthExpressions.geometry.round.toFixed(2)} / {mouthExpressions.geometry.width.toFixed(2)} / {mouthExpressions.geometry.activity.toFixed(2)}</p>
        <p>Vowels aa/ih/ou/ee/oh: <strong>{mouthExpressions.visemes.aa.toFixed(2)} / {mouthExpressions.visemes.ih.toFixed(2)} / {mouthExpressions.visemes.ou.toFixed(2)} / {mouthExpressions.visemes.ee.toFixed(2)} / {mouthExpressions.visemes.oh.toFixed(2)}</strong></p>
        <p>Corrective pucker/funnel/narrow/wide: {mouthExpressions.corrective.pucker.toFixed(2)} / {mouthExpressions.corrective.funnel.toFixed(2)} / {mouthExpressions.corrective.narrow.toFixed(2)} / {mouthExpressions.corrective.wide.toFixed(2)}</p>
        <p>Upper/lower: {mouthExpressions.corrective.upperUp.toFixed(2)} / {mouthExpressions.corrective.lowerDown.toFixed(2)}</p>
      </article>
      <article><h2>F4 expression dynamics</h2>
        <p>Lifecycle: <strong>{facialDynamics.lifecycle}</strong> · sample {facialDynamics.sampleDisposition} · {facialDynamics.filtered ? "dynamics ON" : "bypass"}</p>
        <p>dt: {number(facialDynamics.dtMs)}ms · gap rebase: {facialDynamics.gapRebased ? "yes" : "no"}</p>
        <p>Final blink L/R: <strong>{number(facialDynamics.final.blinkLeft, 2)} / {number(facialDynamics.final.blinkRight, 2)}</strong></p>
        <p>Final squint evidence L/R (raw eye Joy disabled): <strong>{number(facialDynamics.final.eyeSquintLeft, 2)} / {number(facialDynamics.final.eyeSquintRight, 2)}</strong></p>
        <p>Final smile closed/open · frown: <strong>{number(facialDynamics.final.mouthSmileClosed, 2)} / {number(facialDynamics.final.mouthSmileOpen, 2)} · {number(facialDynamics.final.mouthFrown, 2)}</strong></p>
        <p>Final close · vowel sum: <strong>{number(facialDynamics.final.mouthClose, 2)} · {number(["aa", "ih", "ou", "ee", "oh"].reduce((total, name) => total + (facialDynamics.final[name] ?? 0), 0), 2)}</strong></p>
        <p>Conflict pre/post: {facialDynamics.preMix.conflicts.join(", ") || "none"} / {facialDynamics.postMix.conflicts.join(", ") || "none"}</p>
        <p>Budget scale: {Object.entries(facialDynamics.postMix.budgets).filter(([, value]) => value.scale < .999).map(([name, value]) => `${name} ${value.scale.toFixed(2)}`).join(" · ") || "none"}</p>
      </article>
      <article><h2>F4 fast-speech telemetry</h2>
        <p><small>DEV/local-only · cửa sổ peak 1 giây; chỉ lưu scalar blendshape, không lưu ảnh/landmark.</small></p>
        <p>Face samples: <strong>{mouthTelemetry.window.sampleCount}</strong> · effective {number(mouthTelemetry.window.sampleRateFps)} FPS · active {mouthTelemetry.window.activeSampleCount}</p>
        <p>Current timestamp/dt: {number(mouthTelemetry.current?.sampledAtMs, 0)} / {number(mouthTelemetry.current?.deltaTimeMs)} ms</p>
        <p>Current raw/calibrated jaw: <strong>{number(mouthTelemetry.current?.raw.jawOpen, 2)} / {number(mouthTelemetry.current?.calibrated.jawOpen, 2)}</strong></p>
        <p>Current raw→cal pucker/funnel: <strong>{number(mouthTelemetry.current?.raw.mouthPucker, 2)}→{number(mouthTelemetry.current?.calibrated.mouthPucker, 2)} / {number(mouthTelemetry.current?.raw.mouthFunnel, 2)}→{number(mouthTelemetry.current?.calibrated.mouthFunnel, 2)}</strong></p>
        <p>Current opening/round/stretch/activity: <strong>{number(mouthTelemetry.current?.speechActivity.visibleOpening, 2)} / {number(mouthTelemetry.current?.speechActivity.round, 2)} / {number(mouthTelemetry.current?.speechActivity.stretch, 2)} / {number(mouthTelemetry.current?.speechActivity.candidate, 2)}</strong></p>
        <p>Corrective current/boost/envelope/gain: <strong>{number(mouthTelemetry.current?.corrective.currentAmplitude, 2)} / {number(mouthTelemetry.current?.corrective.boostedAmplitude, 2)} / {number(mouthTelemetry.current?.corrective.preservedEnvelope, 2)} / {number(mouthTelemetry.current?.corrective.envelopeGain, 2)}</strong> · {mouthTelemetry.current?.corrective.disposition ?? "—"}</p>
        <p>Current vowel F3 → desired → dynamic → final: <strong>{number(mouthTelemetry.current?.stages.f3Mapped.vowelSum, 2)} → {number(mouthTelemetry.current?.stages.f4Desired.vowelSum, 2)} → {number(mouthTelemetry.current?.stages.f4Dynamic.vowelSum, 2)} → {number(mouthTelemetry.current?.stages.f4Final.vowelSum, 2)}</strong></p>
        <p>Peak raw/calibrated/open/activity: <strong>{number(mouthTelemetry.window.peaks.rawJawOpen, 2)} / {number(mouthTelemetry.window.peaks.calibratedJawOpen, 2)} / {number(mouthTelemetry.window.peaks.visibleOpening, 2)} / {number(mouthTelemetry.window.peaks.speechActivity, 2)}</strong></p>
        <p>Peak boosted/envelope: <strong>{number(mouthTelemetry.window.peaks.boostedAmplitude, 2)} / {number(mouthTelemetry.window.peaks.preservedEnvelope, 2)}</strong></p>
        <p>Peak vowel F3 → desired → dynamic → final: <strong>{number(mouthTelemetry.window.peaks.f3VowelSum, 2)} → {number(mouthTelemetry.window.peaks.desiredVowelSum, 2)} → {number(mouthTelemetry.window.peaks.dynamicVowelSum, 2)} → {number(mouthTelemetry.window.peaks.finalVowelSum, 2)}</strong></p>
        <p>Peak final closure: <strong>{number(mouthTelemetry.window.peaks.finalClosure, 2)}</strong></p>
        <p>Sent to VRM: {(["aa", "ih", "ou", "ee", "oh", "mouthClose"] as const).map((name) => {
          const applied = appliedFacialExpressions[name];
          return applied ? `${name}→${applied.modelName} ${number(applied.value, 2)}` : `${name} —`;
        }).join(" · ")}</p>
      </article>
      <AudioQualificationPanel metrics={{
        rendererFps: rendererMetrics?.fps ?? null,
        trackingFps: trackingMetrics?.cameraFps ?? null,
        pipelineFps: trackingMetrics?.pipelineFps ?? null,
        processorToDrawMs: rendererMetrics?.processorInputToDrawMs ?? null,
        trackingToRenderMs: rendererMetrics?.poseAgeMs ?? null,
      }} />
      <article><h2>Finger rig (3B.3)</h2>
        <p>AR6 continuous: <strong>{continuousFingerEnabled?"ON":"OFF"}</strong></p>
        {continuousFingerEnabled&&<details><summary>JSON diagnostic thô</summary><pre>{JSON.stringify(continuousFingerDiagnostics,null,2)}</pre></details>}
        <p>Gesture: <strong>{gestureEnabled ? "ON" : "OFF (Phase 3B nguyên trạng)"}</strong></p>
        {gestureEnabled && <p style={{ fontSize: "1.1em" }}>Nhãn — trái: <strong>{gesturePoses.left}</strong> · phải: <strong>{gesturePoses.right}</strong></p>}
        {fingerRig ? <>
          <p>Điều khiển được: trái {fingerRig.left.controllableSegmentCount}/15 · phải {fingerRig.right.controllableSegmentCount}/15</p>
          {([fingerRig.left, fingerRig.right]).map((hand) => (
            <p key={hand.side}>{hand.side === "left" ? "Trái" : "Phải"}: {hand.chains.map((chain) =>
              `${chain.finger} ${chain.segments.length}/3${chain.truncatedAtSegment ? ` (dừng ở ${chain.truncatedAtSegment})` : ""}`).join(" · ")}</p>
          ))}
        </> : <p>Chưa có rig ngón (model chưa tải hoặc không phải VRM).</p>}
      </article>
      {continuousFingerEnabled&&fingerRig&&<article className="finger-io-panel"><h2>AR6 finger input → output</h2>
        <p><small>Input = góc từ landmark mới nhất. Target = sau hold/predict. Output = sau clamp + One-Euro. “2D reset” cho biết ảnh 2D đã bác flexion chiều sâu giả.</small></p>
        <div className="finger-trace-controls">
          {!fingerTraceActive?<button type="button" onClick={startFingerTrace}>Bắt đầu ghi AR6</button>:<button type="button" onClick={stopFingerTrace}>Dừng ghi</button>}
          <button type="button" disabled={fingerTraceCount===0&&fingerTraceRef.current.length===0} onClick={downloadFingerTrace}>Tải JSON</button>
          <span>{fingerTraceActive?"Đang ghi":"Đã dừng"} · {fingerTraceCount||fingerTraceRef.current.length}/300 frame</span>
        </div>
        {(["left","right"] as const).map((side)=><section key={side} className="finger-io-side">
          <h3>{side==="left"?"Tay trái":"Tay phải"}</h3>
          <div className="finger-io-scroll"><table><thead><tr>
            <th>Khớp</th><th>Nguồn</th><th>Input</th><th>Target</th><th>Clamp</th><th>Output</th><th>Abd in</th><th>Abd rest</th><th>Abd delta</th><th>2D reset</th><th>Anatomy</th><th>Accepted</th><th>Joint conf.</th><th>Reject</th><th>Flex axis</th><th>Abd axis</th><th>Quaternion output</th>
          </tr></thead><tbody>
            {fingerRig[side].chains.flatMap((chain)=>chain.segments.map((segment)=>{
              const diagnostic=continuousFingerDiagnostics[side][segment.joint];
              const output=packet?.jointRotations[segment.joint];
              return <tr key={segment.joint} className={diagnostic?.source!=="observed"?"finger-io-stale":""}>
                <td>{segment.joint.replace(side,"")}</td><td>{diagnostic?.source??"—"}</td>
                <td>{degrees(diagnostic?.observedAngleRad)}</td><td>{degrees(diagnostic?.targetAngleRad)}</td>
                <td>{degrees(diagnostic?.constrainedAngleRad)}{diagnostic?.limited?" !":""}</td><td>{degrees(diagnostic?.angleRad)}</td>
                <td>{degrees(diagnostic?.observedAbductionRad)}</td><td>{degrees(segment.restAbductionRad)}</td><td>{degrees(diagnostic?.appliedAbductionRad)}</td>
                <td>{diagnostic?.imageExtensionOverride?"YES":"no"}</td><td>{diagnostic?.anatomicalPriorApplied?"YES":"no"}</td><td>{diagnostic?.measurementAccepted?"YES":"no"}</td><td>{number(diagnostic?.measurementConfidence,2)}</td><td>{diagnostic?.rejectionReason??"—"}</td>
                <td>{vector(segment.flexAxisLocal)}</td><td>{vector(segment.abductionAxisLocal)}</td><td>{quaternion(output)}</td>
              </tr>;
            }))}
          </tbody></table></div>
        </section>)}
      </article>}
      <article><h2>Capability</h2>{modelLoading && <p>Đang tải model mới; model hiện tại vẫn được giữ cho tới khi swap thành công.</p>}{capability ? <pre>{JSON.stringify(capability, null, 2)}</pre> : !modelLoading && <p>Chưa có model sẵn sàng.</p>}</article>
      <article><h2>Tracking state</h2>{packet && Object.entries(packet.tracking).map(([name, state]) => <p key={name}>{name}: {state.sourceState} → {state.outputState}</p>)}</article>
      <article><h2>Phase 3B.3 — Thu fixture cử chỉ</h2>
        <p><small>Quy trình: tạo dáng → chờ hand active → Freeze current → chọn nhãn → Thu mẫu. Freeze giữ một sample duy nhất; không lưu ảnh.</small></p>
        <p>
          <label>Tay <select value={fixtureSide} onChange={(e) => setFixtureSide(e.target.value as GestureFixtureCondition["side"])}><option value="left">trái</option><option value="right">phải</option></select></label>{" "}
          <label>Tư thế <select value={fixturePose} onChange={(e) => setFixturePose(e.target.value as GestureFixturePose)}>
            <option value="open">open (xoè)</option><option value="fist">fist (nắm)</option><option value="point">point (chỉ)</option>
            <option value="thumbUp">thumbUp (cái LÊN)</option><option value="thumbSide">thumbSide (cái NGANG)</option><option value="thumbDown">thumbDown (cái XUỐNG)</option>
            <option value="relaxed">relaxed (nghỉ)</option><option value="peace">peace (chữ V)</option>
            <option value="ok">ok (cái+trỏ vòng tròn)</option><option value="rock">rock (trỏ+út)</option>
            <option value="heartFinger">heartFinger (tym 1 tay)</option><option value="callMe">callMe (cái+út)</option>
            <option value="other">other (âm tính khác)</option>
          </select></label>
        </p>
        <p>
          <label>Hướng <select value={fixtureOrientation} onChange={(e) => setFixtureOrientation(e.target.value as GestureFixtureOrientation)}>
            <option value="palm-to-camera">lòng bàn tay</option><option value="back-to-camera">mu bàn tay</option><option value="edge-on">nghiêng cạnh</option>
          </select></label>{" "}
          <label>Khoảng cách <select value={fixtureDistance} onChange={(e) => setFixtureDistance(e.target.value as GestureFixtureDistance)}>
            <option value="near">gần</option><option value="normal">vừa</option><option value="far">xa</option>
          </select></label>{" "}
          <label>Che <select value={fixtureOcclusion} onChange={(e) => setFixtureOcclusion(e.target.value as GestureFixtureOcclusion)}>
            <option value="none">không</option><option value="partial-fingers">che một phần ngón</option>
          </select></label>
          <label>Nhóm <select value={fixtureSplit} onChange={(e) => setFixtureSplit(e.target.value as GestureFixtureSplit)}>
            <option value="calibration">calibration</option><option value="holdout">hold-out</option>
          </select></label>
        </p>
        <p>
          <button onClick={captureFixture}>Thu mẫu</button>{" "}
          <button onClick={startAutoCapturePair} disabled={fixtureAutoTimerRef.current !== null}>Tự thu 2 nhóm (live)</button>{" "}
          <button onClick={() => stopAutoCapture("Đã dừng tự thu.")} disabled={fixtureAutoTimerRef.current === null}>Dừng tự thu</button>{" "}
          <button onClick={undoFixture} disabled={fixtureCount === 0}>Xoá mẫu cuối</button>{" "}
          <button onClick={exportFixtures} disabled={fixtureCount === 0}>Xuất JSON</button>{" "}
          <button onClick={clearFixtures} disabled={fixtureCount === 0}>Xoá hết</button>
        </p>
        <p>Đã thu: <strong>{fixtureCount}</strong> mẫu · {fixtureStatus}</p>
        {fixtureGaps.complete
          ? <p><strong>Đã phủ đủ điều kiện tối thiểu.</strong></p>
          : <p>Còn thiếu:{" "}
              {fixtureGaps.missingSidePose.length > 0 && <>tư thế {fixtureGaps.missingSidePose.map((gap) => `${gap.side}/${gap.pose}/${gap.split}`).join(", ")}. </>}
              {fixtureGaps.missingOrientations.length > 0 && <>hướng {fixtureGaps.missingOrientations.join(", ")}. </>}
              {fixtureGaps.missingDistances.length > 0 && <>khoảng cách {fixtureGaps.missingDistances.join(", ")}. </>}
              {!fixtureGaps.hasPartialOcclusion && <>chưa có mẫu che ngón.</>}
            </p>}
      </article>
      <article><h2>Phase 3B partial-arm</h2>
        {(["left", "right"] as const).map((side) => {
          const arm = motionDiagnostics?.arms[side];
          if (!arm) return <p key={side}>{side}: —</p>;
          const flag = (name: string) => arm.confidenceFlags.includes(name);
          return <p key={side}>
            {arm.spatial && <><small>search {arm.spatial.candidateCount} · face {arm.spatial.faceEvidenceUsed ? (arm.spatial.intentionalFaceContact ? "contact" : "clearance") : "n/a"} · penalty F/H/T {arm.spatial.facePenalty.toFixed(2)}/{arm.spatial.headCollisionPenalty.toFixed(2)}/{arm.spatial.torsoCollisionPenalty.toFixed(2)} · palm {motionDiagnostics?.handTwist[side]?.alignmentMode ?? "legacy"}</small><br /></>}
            <strong>{side}</strong>: upper <em>{arm.segmentLossState.upper}</em> · lower <em>{arm.segmentLossState.lower}</em><br />
            elbow {arm.elbowInference.source} · pole {arm.poleSource}<br />
            wrist {arm.wristEvidence?.source ?? "legacy"} · grace {arm.wristEvidence ? Math.round(arm.wristEvidence.effectiveGraceMs) : "—"}ms
            {arm.wristEvidence?.reconstructionConfidence !== null && arm.wristEvidence?.reconstructionConfidence !== undefined && <> · reconstruct {arm.wristEvidence.reconstructionConfidence.toFixed(2)}</>}
            {arm.wristEvidence?.reconstructionRejectionReason && <> · wrist reject {arm.wristEvidence.reconstructionRejectionReason}</>}
            {flag("elbow-side-flip-prevented") && <> · <strong>side-flip chặn</strong></>}
            {flag("elbow-anatomy-flip") && <> · <strong>deep-inside đổi nhánh</strong></>}
            {flag("observed-elbow-hand-conflict") && <> · <strong>Pose elbow bị Hand bác bỏ</strong></>}
            {flag("elbow-hand-palm-branch") && <> · <strong>palm chọn nhánh</strong></>}
            {arm.hardRejectionReason && <> · reject {arm.hardRejectionReason}</>}
            {arm.observation.lowerRejectionReason && <> · lower {arm.observation.lowerRejectionReason}</>}
            {flag("observed-elbow-head-collision") && <> · <strong>Pose elbow xuyên head bị bác bỏ</strong></>}
            {flag("elbow-face-clearance-branch") && <> · <strong>face-clearance đổi mặt phẳng</strong></>}
            {flag("elbow-rig-collision-branch") && <> · <strong>collision rig đổi mặt phẳng</strong></>}
          </p>;
        })}
      </article>
      <article><h2>Phase 3A arm-frame</h2><p>Head: legacy/unverified, excluded from arm acceptance.</p><pre>{JSON.stringify(motionDiagnostics, null, 2)}</pre></article>
    </section>
  </main>;
}
