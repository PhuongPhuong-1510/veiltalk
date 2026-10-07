import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Group } from "three";
import { AvatarCanvas } from "../avatar/AvatarCanvas";
import { AvatarMotionProcessor } from "../../lib/avatar-motion/avatarMotionProcessor";
import type { AvatarPosePacket } from "../../lib/avatar-motion/avatarPoseTypes";
import type { AvatarMotionDiagnosticSnapshot } from "../../lib/avatar-motion/avatarMotionDiagnostics";
import type { FacialNeutralCalibrationSnapshot } from "../../lib/avatar-motion/facialNeutralCalibration";
import type { EyeBrowExpressionSnapshot } from "../../lib/avatar-motion/eyeBrowExpression";
import type { MouthExpressionSnapshot } from "../../lib/avatar-motion/mouthExpression";
import type { FacialExpressionDynamicsSnapshot } from "../../lib/avatar-motion/facialExpressionDynamics";
import type { GazeDiagnostics } from "../../lib/avatar-motion/gazeSolver";
import type { GazeEyelidDiagnostic } from "../../lib/avatar-motion/gazeEyelidCoupling";
import type { GazeMetricsSnapshot } from "../../lib/avatar-motion/gazeMetrics";
import type { FingerRigProfile } from "../../lib/avatar-motion/fingerRig";
import type { AppliedSelfCollisionDiagnostic, AvatarRenderer } from "../../lib/avatar-renderer/avatarRenderer";
import type { AppliedGazeDiagnostic, GazeCapability } from "../../lib/avatar-renderer/gazeCapabilityAdapter";
import { clearDiagnosticHelpers, createDiagnosticHelpers, updateDiagnosticHelpers } from "../../lib/avatar-renderer/avatarDiagnostics";
import type { ModelCapabilityReport } from "../../lib/avatar-renderer/modelTypes";
import type { RendererMetricsSnapshot } from "../../lib/avatar-renderer/rendererMetrics";
import { isCurrentModelLoadRequest } from "../../lib/avatar-renderer/modelLoader";
import type { RawTrackingFrameV1 } from "../../lib/tracking/rawTrackingTypes";
import type { TrackingMetricsSnapshot } from "../../lib/tracking/trackingMetrics";
import { MotionReplayPanel } from "./MotionReplayPanel";
import { INTEGRATED_MOTION_PROFILE as profile } from "../../lib/avatar-motion/integratedMotionProfile";
import { MotionRecorder, rebaseTrackingFrame, type MotionRecordingV1 } from "../../lib/avatar-motion/motionReplay";
import { useTracking } from "../../lib/tracking/useTracking";
import { DEFAULT_POSE_MODEL, type PoseModelVariant } from "../../lib/tracking/mediaPipeRuntime";
import { DEFAULT_DEV_AVATAR_MODEL_ID, DEV_AVATAR_MODELS, getDevAvatarModel, type DevAvatarModel } from "./devAvatarModels";
import type { UpperBodyCalibrationSnapshot } from "../../lib/avatar-motion/upperBodyCalibration";
import "./avatarRendererDevHarness.css";

const DIAGNOSTIC_CONVERSION = "current" as const;
const number = (value: number | null | undefined, digits = 1) => value === null || value === undefined || !Number.isFinite(value) ? "—" : value.toFixed(digits);
const vector = (value: {x:number;y:number;z:number}|null|undefined) => value ? `${value.x.toFixed(2)}, ${value.y.toFixed(2)}, ${value.z.toFixed(2)}` : "—";

export default function AvatarRendererDevHarness() {
  const videoRef = useRef<HTMLVideoElement>(null); const rendererRef = useRef<AvatarRenderer | null>(null); const helpersRef = useRef<Group | null>(null);
  const stageRef = useRef<HTMLElement>(null);
  const modelLoadRequestRef = useRef(0);
  const freezeTimerRef = useRef<number | null>(null);
  const evidenceCaptureTimerRef = useRef<number | null>(null);
  const [motionProcessor] = useState(() => new AvatarMotionProcessor({continuousFingerEnabled:true})); const processorRef = useRef(motionProcessor); const latestPacket = useRef<AvatarPosePacket | null>(null); const latestRaw = useRef<RawTrackingFrameV1 | null>(null); const frozenRaw = useRef<RawTrackingFrameV1 | null>(null);
  const { filtered, constraints, smoothing, handTwistEnabled, continuousFingerEnabled,
    bimanualPalmAssistEnabled, fingertipContactEnabled, dofConstraintsEnabled,
    bodyDepthBarrierEnabled, depthFusionEnabled, rigEndpointEnabled,
    elbowBranchSwitchEnabled, handConditioningEnabled, poseDepthConditioningEnabled,
    parallelHands, poseGuidedHands, adaptiveHandConfidence, processorArmTemporal,
    contactShadowEnabled, contactCorrectionEnabled, faceContactResearch } = profile;
  const motionRecorderRef = useRef(new MotionRecorder());
  const replayActiveRef = useRef(false);
  const replayRequestRef = useRef<number | null>(null);
  const [trackingStarting,setTrackingStarting] = useState(false);
  const faceMaterialOverrides=useRef<Record<string,string[]>>({});
  const [faceMaterialNames,setFaceMaterialNames]=useState("");
  const [contactDiagnostics,setContactDiagnostics]=useState(()=>processorRef.current.getContactDiagnostics());
  const [fingerRig, setFingerRig] = useState<FingerRigProfile | null>(null);
  const [helpers, setHelpers] = useState(false); const [frozen, setFrozen] = useState(false);
  const [freezeCountdown, setFreezeCountdown] = useState<number | null>(null);
  const [evidenceCaptureCountdown, setEvidenceCaptureCountdown] = useState<number | null>(null);
  const [evidenceCaptureStatus, setEvidenceCaptureStatus] = useState<string | null>(null);
  const [simulatedLoss, setSimulatedLoss] = useState(false); const [trackingRunning, setTrackingRunning] = useState(false); const [rendererRunning, setRendererRunning] = useState(true);
  const [poseModel, setPoseModel] = useState<PoseModelVariant>(DEFAULT_POSE_MODEL);
  const [avatarModelId, setAvatarModelId] = useState(DEFAULT_DEV_AVATAR_MODEL_ID);
  const [zoom, setZoom] = useState(1); const [verticalOffset, setVerticalOffset] = useState(0);
  const [error, setError] = useState<string | null>(null); const [capability, setCapability] = useState<ModelCapabilityReport | null>(null); const [packet, setPacket] = useState<AvatarPosePacket | null>(null);
  const [facialCalibration, setFacialCalibration] = useState<FacialNeutralCalibrationSnapshot>(() => processorRef.current.getFacialCalibration());
  const [upperBodyCalibration, setUpperBodyCalibration] = useState<UpperBodyCalibrationSnapshot>(() => processorRef.current.getUpperBodyCalibration());
  const [selfCollision, setSelfCollision] = useState<AppliedSelfCollisionDiagnostic | null>(null);
  const [eyeBrowExpressions, setEyeBrowExpressions] = useState<EyeBrowExpressionSnapshot>(() => processorRef.current.getEyeBrowExpressions());
  const [mouthExpressions, setMouthExpressions] = useState<MouthExpressionSnapshot>(() => processorRef.current.getMouthExpressions());
  const [facialDynamics, setFacialDynamics] = useState<FacialExpressionDynamicsSnapshot>(() => processorRef.current.getFacialDynamics());
  const [gazeDiagnostics, setGazeDiagnostics] = useState<GazeDiagnostics>(() => processorRef.current.getGazeDiagnostics());
  const [gazeMetrics, setGazeMetrics] = useState<GazeMetricsSnapshot>(() => processorRef.current.getGazeMetrics());
  const [gazeEyelidDiagnostic, setGazeEyelidDiagnostic] = useState<GazeEyelidDiagnostic>(() => processorRef.current.getGazeEyelidDiagnostic());
  const [gazeMode, setGazeMode] = useState<"faithful" | "cinematic">("faithful");
  const [gazeAttention, setGazeAttention] = useState(0);
  const [gazeCapability, setGazeCapability] = useState<GazeCapability | null>(null);
  const [appliedGaze, setAppliedGaze] = useState<AppliedGazeDiagnostic | null>(null);
  const [motionDiagnostics, setMotionDiagnostics] = useState<AvatarMotionDiagnosticSnapshot | null>(null);
  const [rendererMetrics, setRendererMetrics] = useState<RendererMetricsSnapshot | null>(null); const [trackingMetrics, setTrackingMetrics] = useState<TrackingMetricsSnapshot | null>(null);
  const [modelLoading, setModelLoading] = useState(false);

  const trackingMetricsRef = useRef(trackingMetrics); trackingMetricsRef.current = trackingMetrics;
  const latestContactInput=useRef<RawTrackingFrameV1|null>(null);
  const simulatedLossRef = useRef(simulatedLoss); simulatedLossRef.current = simulatedLoss;
  const processInput = useCallback((frame: RawTrackingFrameV1) => {
    const input = simulatedLossRef.current ? { ...frame, face: { ...frame.face, state: "lost" as const }, leftHand: { ...frame.leftHand, state: "lost" as const }, rightHand: { ...frame.rightHand, state: "lost" as const }, pose: { ...frame.pose, state: "lost" as const } } : frame;
    const next = processorRef.current.process(input); latestPacket.current = next; rendererRef.current?.applyPose(next);
    latestContactInput.current=input;
    if (!replayActiveRef.current && motionRecorderRef.current.active) motionRecorderRef.current.record(input,next,performance.now(),{arm:processorRef.current.getLastDiagnostics(),contact:processorRef.current.getContactDiagnostics(),fingers:processorRef.current.getContinuousFingerDiagnostics(),bimanual:processorRef.current.getBimanualHandDiagnostics(),tracking:trackingMetricsRef.current},rendererRef.current?.getFinalArmSnapshot()??null);
  }, []);
  const onFrame = useCallback((frame: RawTrackingFrameV1) => { if (frozenRaw.current || replayActiveRef.current) return; latestRaw.current = frame; processInput(frame); }, [processInput]);
  function downloadContactEvidence(){
    if(!latestContactInput.current||!latestPacket.current)return;
    const renderer=rendererRef.current;
    const payload={version:1,kind:"face-contact-evidence-snapshot",createdAt:new Date().toISOString(),capturedAtMs:performance.now(),
      metadata:{avatarModelId,poseModel,parallelHands,poseGuidedHands,adaptiveHandConfidence,poseDepthConditioningEnabled,simulatedLoss,fingertipContactEnabled,dofConstraintsEnabled,bodyDepthBarrierEnabled,depthFusionEnabled,bimanualPalmAssistEnabled,rigEndpointEnabled,elbowBranchSwitchEnabled,handConditioningEnabled,processorArmTemporal,filtered,constraints,handTwistEnabled,continuousFingerEnabled,contactShadowEnabled,contactCorrectionEnabled,faceContactResearch},
      raw:latestContactInput.current,packet:latestPacket.current,contact:processorRef.current.getContactDiagnostics(),
      finalPose:renderer?.getFinalArmSnapshot()??null,rigProfile:renderer?.getRigProfile()??null,faceMeshCapability:renderer?.getFaceContactMeshCapability()??null};
    const url=URL.createObjectURL(new Blob([JSON.stringify(payload)],{type:"application/json"}));
    const anchor=document.createElement("a");anchor.href=url;anchor.download=`face-contact-evidence-${new Date().toISOString().replace(/[:.]/g,"-")}.json`;anchor.click();window.setTimeout(()=>URL.revokeObjectURL(url),1000);
  }
  const onMetrics = useCallback((value: TrackingMetricsSnapshot) => { setTrackingMetrics(value); }, []);
  const onError = useCallback((reason: unknown) => {setError(reason instanceof Error ? reason.message : "Tracking error");setTrackingRunning(false);}, []);
  // Đổi model pose phải dựng lại pipeline (useTracking dispose theo options), nên tracking sẽ
  // dừng khi chuyển lite↔full — bấm "Start tracking" lại để đo biến thể mới.
  const trackingOptions = useMemo(() => ({ profile: "full-rate" as const, resolution: "720p" as const, delegate: "GPU" as const, tasks: { face: true, hands: true, pose: true }, poseModel, parallelHands, poseGuidedHands, adaptiveHandConfidence, onFrame, onMetrics, onError }), [poseModel, parallelHands, poseGuidedHands, adaptiveHandConfidence, onFrame, onMetrics, onError]);
  const tracking = useTracking(trackingOptions);

  useEffect(() => { processorRef.current.setFiltered(filtered); }, [filtered]);
  useEffect(()=>{processorRef.current.setDofConstraintsEnabled(dofConstraintsEnabled);},[dofConstraintsEnabled]);
  useEffect(()=>{processorRef.current.setBodyDepthBarrierEnabled(bodyDepthBarrierEnabled);},[bodyDepthBarrierEnabled]);
  useEffect(()=>{processorRef.current.setDepthFusionEnabled(depthFusionEnabled);},[depthFusionEnabled]);
  useEffect(()=>{processorRef.current.setBimanualPalmAssistEnabled(bimanualPalmAssistEnabled);},[bimanualPalmAssistEnabled]);
  useEffect(()=>{processorRef.current.setFingertipContactEnabled(fingertipContactEnabled);},[fingertipContactEnabled]);
  useEffect(()=>{processorRef.current.setRigEndpointEnabled(rigEndpointEnabled);},[rigEndpointEnabled]);
  useEffect(()=>{processorRef.current.setElbowBranchSwitchEnabled(elbowBranchSwitchEnabled);},[elbowBranchSwitchEnabled]);
  useEffect(()=>{processorRef.current.setHandConditioningEnabled(handConditioningEnabled);},[handConditioningEnabled]);
  useEffect(()=>{processorRef.current.setPoseDepthConditioningEnabled(poseDepthConditioningEnabled);},[poseDepthConditioningEnabled]);
  useEffect(()=>{processorRef.current.setProcessorArmTemporal(processorArmTemporal);},[processorArmTemporal]);
  const stopMotionReplay = useCallback(()=>{replayActiveRef.current=false;if(replayRequestRef.current!==null)cancelAnimationFrame(replayRequestRef.current);replayRequestRef.current=null;processorRef.current.reset();},[]);
  const playMotionReplay = useCallback((recording:MotionRecordingV1)=>{
    stopMotionReplay();motionRecorderRef.current.stop();replayActiveRef.current=true;
    const start=performance.now(),first=recording.frames[0].atMs,offset=start-first;let index=0;
    const step=()=>{
      if(!replayActiveRef.current)return;
      const elapsed=performance.now()-start;
      // Bound catch-up work so a suspended tab cannot block the main thread.
      let processed=0;while(index<recording.frames.length&&recording.frames[index].atMs-first<=elapsed&&processed++<4){const entry=recording.frames[index++];processInput(rebaseTrackingFrame(entry.raw,offset));}
      if(index<recording.frames.length)replayRequestRef.current=requestAnimationFrame(step);else{replayActiveRef.current=false;replayRequestRef.current=null;processorRef.current.reset();}
    };replayRequestRef.current=requestAnimationFrame(step);
  },[processInput,stopMotionReplay]);
  useEffect(()=>()=>{if(replayRequestRef.current!==null)cancelAnimationFrame(replayRequestRef.current);},[]);
  useEffect(() => { processorRef.current.setConstraints(constraints); }, [constraints]);
  useEffect(() => { processorRef.current.setHandTwistEnabled(handTwistEnabled); }, [handTwistEnabled]);
  useEffect(()=>{processorRef.current.setContinuousFingerEnabled(continuousFingerEnabled);},[continuousFingerEnabled]);
  useEffect(()=>{processorRef.current.setContactShadowEnabled(contactShadowEnabled);},[contactShadowEnabled]);
  useEffect(()=>{processorRef.current.setContactCorrectionEnabled(contactCorrectionEnabled);},[contactCorrectionEnabled]);
  useEffect(()=>{processorRef.current.setFaceContactResearchOptions(faceContactResearch);},[faceContactResearch]);
  useEffect(() => { processorRef.current.setGazeMode(gazeMode); }, [gazeMode]);
  useEffect(() => { processorRef.current.setGazeAttentionStrength(gazeAttention); }, [gazeAttention]);
  useEffect(() => { rendererRef.current?.setSmoothing(smoothing); }, [smoothing]);
  useEffect(() => { rendererRef.current?.setZoom(zoom); }, [zoom]);
  useEffect(() => { rendererRef.current?.setVerticalOffset(verticalOffset); }, [verticalOffset]);
  useEffect(() => {
    const timer = window.setInterval(() => {
      setContactDiagnostics(processorRef.current.getContactDiagnostics());
      const renderer = rendererRef.current; const raw = frozenRaw.current ?? latestRaw.current; setPacket(latestPacket.current); setMotionDiagnostics(processorRef.current.getLastDiagnostics()); setFacialCalibration(processorRef.current.getFacialCalibration()); setUpperBodyCalibration(processorRef.current.getUpperBodyCalibration()); setEyeBrowExpressions(processorRef.current.getEyeBrowExpressions()); setMouthExpressions(processorRef.current.getMouthExpressions()); setFacialDynamics(processorRef.current.getFacialDynamics()); setGazeDiagnostics(processorRef.current.getGazeDiagnostics()); setGazeMetrics(processorRef.current.getGazeMetrics()); setGazeEyelidDiagnostic(processorRef.current.getGazeEyelidDiagnostic()); if (!renderer) return;
      setSelfCollision(renderer.getSelfCollisionDiagnostics());
      setGazeCapability(renderer.getGazeCapability()); setAppliedGaze(renderer.getAppliedGaze());
      setRendererMetrics(renderer.getMetrics()); const model = renderer.getDiagnosticModel(); if (!model) return;
      if (raw?.pose.worldLandmarks && helpersRef.current) updateDiagnosticHelpers(helpersRef.current, model.bones, raw.pose.worldLandmarks, DIAGNOSTIC_CONVERSION);
    }, 400); return () => window.clearInterval(timer);
  }, []);
  useEffect(() => () => { if (freezeTimerRef.current !== null) window.clearInterval(freezeTimerRef.current); if (evidenceCaptureTimerRef.current !== null) window.clearInterval(evidenceCaptureTimerRef.current); if (helpersRef.current) clearDiagnosticHelpers(helpersRef.current); processorRef.current.dispose(); }, []);
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
    setFingerRig(null);
    setCapability(null);
    setMouthExpressions(processorRef.current.getMouthExpressions());
    setFacialDynamics(processorRef.current.getFacialDynamics());
    setUpperBodyCalibration(processorRef.current.getUpperBodyCalibration());
    setGazeCapability(null); setAppliedGaze(null); setGazeDiagnostics(processorRef.current.getGazeDiagnostics()); setGazeMetrics(processorRef.current.getGazeMetrics()); setGazeEyelidDiagnostic(processorRef.current.getGazeEyelidDiagnostic());
  }, []);

  const loadRendererModel = useCallback(async (renderer: AvatarRenderer, model: DevAvatarModel) => {
    const requestId = ++modelLoadRequestRef.current;
    setModelLoading(true);
    setError(null);
    resetModelMotionState();
    if (helpersRef.current) { clearDiagnosticHelpers(helpersRef.current); helpersRef.current = null; }
    try {
      const report = await renderer.loadModel(model.url, { licenseStatus: "unknown",faceContactMaterials:faceMaterialOverrides.current[model.id] });
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
  async function toggleTracking() { if (!tracking || !videoRef.current || trackingStarting) return; if (trackingRunning) { tracking.stop(); processorRef.current.resetCameraTracking(); setTrackingMetrics(null); setTrackingRunning(false); } else { setError(null); setTrackingMetrics(null); setTrackingStarting(true); processorRef.current.resetCameraTracking(); try { await tracking.start(videoRef.current); setTrackingRunning(tracking.state === "running"); } catch(reason) { onError(reason); } finally { setTrackingStarting(false); } } }
  function toggleRenderer() { const renderer = rendererRef.current; if (!renderer) return; if (rendererRunning) renderer.stop(); else renderer.start(); setRendererRunning(!rendererRunning); }
  function toggleFreeze() { if (frozenRaw.current) { frozenRaw.current = null; setFrozen(false); return; } if (!latestRaw.current) return; frozenRaw.current = structuredClone(latestRaw.current); setFrozen(true); processInput(frozenRaw.current); }
  function freezeAfterCountdown() {
    if (frozenRaw.current || freezeTimerRef.current !== null || !latestRaw.current) return;
    let remaining = 5; setFreezeCountdown(remaining);
    freezeTimerRef.current = window.setInterval(() => {
      remaining -= 1; setFreezeCountdown(remaining);
      if (remaining > 0) return;
      window.clearInterval(freezeTimerRef.current!); freezeTimerRef.current = null; setFreezeCountdown(null); toggleFreeze();
    }, 1000);
  }
  function drawMirroredCover(context: CanvasRenderingContext2D, source: CanvasImageSource, sourceWidth: number, sourceHeight: number, x: number, y: number, width: number, height: number) {
    const scale = Math.max(width / sourceWidth, height / sourceHeight);
    const cropWidth = width / scale;
    const cropHeight = height / scale;
    context.save();
    context.translate(x + width, y);
    context.scale(-1, 1);
    context.drawImage(source, (sourceWidth - cropWidth) / 2, (sourceHeight - cropHeight) / 2, cropWidth, cropHeight, 0, 0, width, height);
    context.restore();
  }
  function captureEvidenceImage() {
    const avatarCanvas = stageRef.current?.querySelector("canvas");
    const video = videoRef.current;
    if (!avatarCanvas || !video || video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA || video.videoWidth === 0) {
      setEvidenceCaptureStatus("Không thể chụp: hãy bật camera và chờ hình ảnh xuất hiện.");
      return;
    }

    const panelWidth = 960; const panelHeight = 540; const labelHeight = 52; const gap = 12;
    const output = document.createElement("canvas");
    output.width = panelWidth * 2 + gap; output.height = panelHeight + labelHeight;
    const context = output.getContext("2d");
    if (!context) { setEvidenceCaptureStatus("Không thể tạo ảnh bằng chứng trên trình duyệt này."); return; }
    context.fillStyle = "#0d0b14"; context.fillRect(0, 0, output.width, output.height);
    drawMirroredCover(context, avatarCanvas, avatarCanvas.width, avatarCanvas.height, 0, labelHeight, panelWidth, panelHeight);
    drawMirroredCover(context, video, video.videoWidth, video.videoHeight, panelWidth + gap, labelHeight, panelWidth, panelHeight);
    context.fillStyle = "#f5f3ff"; context.font = "600 24px Inter, sans-serif";
    context.fillText("Avatar", 18, 34); context.fillText("Webcam", panelWidth + gap + 18, 34);
    output.toBlob((blob) => {
      if (!blob) { setEvidenceCaptureStatus("Không thể xuất ảnh PNG."); return; }
      const url = URL.createObjectURL(blob); const link = document.createElement("a");
      link.href = url; link.download = `avatar-evidence-${new Date().toISOString().replace(/[:.]/g, "-")}.png`; link.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      setEvidenceCaptureStatus("Đã chụp và tải ảnh avatar + webcam.");
    }, "image/png");
  }
  function captureEvidenceAfterCountdown() {
    if (evidenceCaptureTimerRef.current !== null) return;
    if (!trackingRunning || !latestRaw.current) { setEvidenceCaptureStatus("Hãy bật Start tracking trước khi chụp."); return; }
    setEvidenceCaptureStatus(null);
    let remaining = 5; setEvidenceCaptureCountdown(remaining);
    evidenceCaptureTimerRef.current = window.setInterval(() => {
      remaining -= 1;
      if (remaining > 0) { setEvidenceCaptureCountdown(remaining); return; }
      window.clearInterval(evidenceCaptureTimerRef.current!); evidenceCaptureTimerRef.current = null; setEvidenceCaptureCountdown(null);
      // Chụp ngay sau lượt render kế tiếp để WebGL canvas vẫn còn đầy đủ pixel.
      window.requestAnimationFrame(() => captureEvidenceImage());
    }, 1000);
  }
  return <main className="avatar-renderer-dev">
    <header><div><strong>DEV ONLY · LOCAL ONLY</strong><h1>P4-T10 Retargeting Diagnostics</h1></div><p>Ảnh bằng chứng chỉ được tải xuống máy, không upload raw frame.</p></header>
    {error && <pre className="dev-error" role="alert">{error}</pre>}
    <section className="dev-controls">
      <button onClick={() => void toggleTracking()}>{trackingRunning ? "Stop tracking" : "Start tracking"}</button><button onClick={toggleRenderer}>{rendererRunning ? "Stop renderer" : "Start renderer"}</button><button onClick={reloadModel} disabled={modelLoading}>{modelLoading ? "Loading model…" : "Reload model"}</button><button onClick={() => { processorRef.current.calibrateFaceNeutral(); setFacialCalibration(processorRef.current.getFacialCalibration()); setUpperBodyCalibration(processorRef.current.getUpperBodyCalibration()); }}>Calibrate neutral face + upper body</button><span className={`facial-calibration-badge ${facialCalibration.state}`}>F1: {facialCalibration.state} · {facialCalibration.acceptedSamples}/{facialCalibration.requiredSamples} · {facialCalibration.collectionMode}</span><span className="eye-brow-badge">AR4: {upperBodyCalibration.state} · {upperBodyCalibration.acceptedPairs}/{upperBodyCalibration.requiredPairs} · {upperBodyCalibration.mode}</span><span className="eye-brow-badge">F2 blink L/R: {eyeBrowExpressions.blinkLeft.toFixed(2)}/{eyeBrowExpressions.blinkRight.toFixed(2)}{eyeBrowExpressions.unilateralCandidate ? ` · guard ${eyeBrowExpressions.unilateralCandidate}` : ""}</span>
      <button onClick={toggleFreeze} disabled={!frozen && !latestRaw.current}>{frozen ? "Unfreeze" : "Freeze current"}</button><button onClick={freezeAfterCountdown} disabled={frozen || freezeCountdown !== null || !latestRaw.current}>{freezeCountdown === null ? "Freeze in 5s" : `Freeze in ${freezeCountdown}s`}</button>
      {frozen&&<span role="status">Frame đang đóng băng</span>}
      <button className="evidence-capture-button" onClick={captureEvidenceAfterCountdown} disabled={evidenceCaptureCountdown !== null}>{evidenceCaptureCountdown === null ? "Chụp bằng chứng sau 5s" : `Chuẩn bị chụp: ${evidenceCaptureCountdown}s`}</button>
      {evidenceCaptureStatus && <span className="evidence-capture-status" role="status">{evidenceCaptureStatus}</span>}
      <label><input type="checkbox" checked={helpers} onChange={(e) => setHelpers(e.target.checked)} /> Helpers</label><label><input type="checkbox" checked={simulatedLoss} onChange={(e) => setSimulatedLoss(e.target.checked)} /> Simulate loss</label>
      <label>Pose model <select value={poseModel} disabled={trackingStarting} onChange={(e) => { if (trackingRunning) { tracking?.stop(); setTrackingRunning(false); } setPoseModel(e.target.value as PoseModelVariant); }}><option value="full">full (chính xác hơn)</option><option value="lite">lite (nhẹ hơn)</option></select></label>
      <label>Avatar model <select value={avatarModelId} onChange={(event) => selectAvatarModel(event.target.value)}>{DEV_AVATAR_MODELS.map((model) => <option key={model.id} value={model.id}>{model.label}</option>)}</select></label>

      <label>Zoom <input type="range" min="0.5" max="3" step="0.05" value={zoom} onChange={(e) => setZoom(Number(e.target.value))} /> {zoom.toFixed(2)}x</label>
      <label>Vị trí trên/dưới <input type="range" min="-0.5" max="0.5" step="0.01" value={verticalOffset} onChange={(e) => setVerticalOffset(Number(e.target.value))} /> {verticalOffset.toFixed(2)}</label>
      <label>Gaze mode <select value={gazeMode} onChange={(event) => setGazeMode(event.target.value as "faithful" | "cinematic")}><option value="faithful">faithful (mặc định)</option><option value="cinematic">cinematic (thử nghiệm)</option></select></label>
      <label>Camera attention <input type="range" min="0" max="1" step="0.05" value={gazeAttention} onChange={(event) => setGazeAttention(Number(event.target.value))} disabled={gazeMode !== "cinematic"} /> {gazeAttention.toFixed(2)}</label>
      <button onClick={() => { setZoom(1); setVerticalOffset(0); }}>Reset khung hình</button>
    </section>
    {trackingStarting&&<p role="status">Đang khởi tạo tracking và nạp model…</p>}
    <section className="dev-stage" ref={stageRef}><AvatarCanvas onReady={attachRenderer} onDispose={detachRenderer} onError={(reason) => setError(`WebGL: ${reason.message}`)} options={{ smoothing, onContextLost: (reason) => setError(reason.message) }} /><div className="dev-camera-preview"><video ref={videoRef} muted playsInline />{!trackingRunning && <p>Camera chưa bật<br /><small>Bấm Start tracking để dùng webcam</small></p>}</div></section>
    <section className="dev-panels">

      <article><h2>Realtime</h2><p>Avatar: <strong>{getDevAvatarModel(avatarModelId)?.label ?? avatarModelId}</strong>{modelLoading ? " · đang tải…" : ""}</p><p>Tracking/Pipeline: {number(trackingMetrics?.cameraFps)} / {number(trackingMetrics?.pipelineFps)} FPS</p><p>Renderer: {number(rendererMetrics?.fps)} FPS · p95 {number(rendererMetrics?.frameTimeP95Ms)}ms</p><p>Processor→draw: {number(rendererMetrics?.processorInputToDrawMs)}ms</p>
        <p>Rig ngón: trái {fingerRig?.left.controllableSegmentCount??0}/15 · phải {fingerRig?.right.controllableSegmentCount??0}/15</p>
        <p>Pose model: <strong>{trackingMetrics?.poseModel ?? `${poseModel} (chưa chạy)`}</strong> · delegate {trackingMetrics?.selectedDelegate ?? "—"}</p>
        <p>Hands: <strong>{trackingMetrics?.handExecution ?? "chưa chạy"}</strong> · {trackingMetrics?.handDelegate ?? "—"} · inference p95 {number(trackingMetrics?.inferenceTimeMs.hands.p95)}ms · tuổi mẫu p95 L/R {number(trackingMetrics?.sampleAgeMs.leftHand.p95)}/{number(trackingMetrics?.sampleAgeMs.rightHand.p95)}ms</p>
        <p>Capture/copy p95 {number(trackingMetrics?.framePreparationMs?.p95)}ms · Hand round-trip p95 {number(trackingMetrics?.handWorkerRoundTripMs?.p95)}ms · mẫu Hand quá cũ {trackingMetrics?.handWorkerDroppedSamples ?? 0} · main-thread blocked {number(trackingMetrics?.mainThreadBlockedMs)}ms</p>
        {trackingMetrics?.handWorkerFallback && <p role="status">Hand worker chưa hoạt động; dùng main thread: {trackingMetrics.handWorkerFallback}</p>}
        <p>Pose inference: {number(trackingMetrics?.inferenceTimeMs.pose.average)}ms trung bình · p95 {number(trackingMetrics?.inferenceTimeMs.pose.p95)}ms · max {number(trackingMetrics?.inferenceTimeMs.pose.max)}ms</p></article>

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

      <article><h2>AR9 hand-body contact</h2>
        <p>Trạng thái: <strong>{contactCorrectionEnabled?"CORRECTION ON":contactShadowEnabled?"SHADOW — diagnostic only":"OFF"}</strong></p>
        <details><summary>Bề mặt mặt của avatar đang dùng</summary><pre>{JSON.stringify(rendererRef.current?.getFaceContactMeshCapability(),null,2)}</pre></details>
        <details><summary>Chọn thủ công vật liệu da mặt khi avatar chưa được nhận diện</summary>
          <label>Tên vật liệu chính xác, ngăn bằng dấu phẩy <input value={faceMaterialNames} onChange={e=>setFaceMaterialNames(e.target.value)}/></label>
          <button disabled={modelLoading} onClick={()=>{const names=faceMaterialNames.split(",").map(s=>s.trim()).filter(Boolean);if(names.length)faceMaterialOverrides.current[avatarModelId]=names;else delete faceMaterialOverrides.current[avatarModelId];reloadModel();}}>Áp dụng cho avatar này và tải lại</button>
          <p>Để trống để trở về nhận diện tự động. Chỉ chọn vật liệu đã kiểm tra là da mặt; tên tóc, mắt và phụ kiện không phù hợp.</p>
        </details>
        <button onClick={downloadContactEvidence} disabled={!packet}>Tải input + diagnostics contact JSON</button>
        <p>Snapshot gồm landmarks đầu vào, cấu hình và kết quả contact; tải về máy. Dùng Record/replay để kiểm tra diễn biến theo thời gian.</p>
        <p>Quan sát trái: {contactDiagnostics.left.research?.observationTrace?.status??"chưa có mẫu"} · phải: {contactDiagnostics.right.research?.observationTrace?.status??"chưa có mẫu"}</p>
        <details open={contactShadowEnabled}><summary>Contact diagnostics</summary><pre>{JSON.stringify(contactDiagnostics,null,2)}</pre></details>
      </article>

      <article><h2>Tracking state</h2>{packet && Object.entries(packet.tracking).map(([name, state]) => <p key={name}>{name}: {state.sourceState} → {state.outputState}</p>)}</article>

      <article><h2>Phase 3B partial-arm</h2>
        {(["left", "right"] as const).map((side) => {
          const arm = motionDiagnostics?.arms[side];
          if (!arm) return <p key={side}>{side}: —</p>;
          const flag = (name: string) => arm.confidenceFlags.includes(name);
          return <p key={side}>
            {arm.spatial && <><small>search {arm.spatial.candidateCount} · branch {arm.spatial.branchDecision ?? "legacy"} ({arm.spatial.pendingHandSamples ?? 0} mẫu) · margin {arm.spatial.scoreMargin?.toFixed(2) ?? "n/a"} · phân biệt ảnh {arm.spatial.handDiscriminabilityRadians === null || arm.spatial.handDiscriminabilityRadians === undefined ? "n/a" : (arm.spatial.handDiscriminabilityRadians * 180 / Math.PI).toFixed(0) + "°"} · face {arm.spatial.faceEvidenceUsed ? (arm.spatial.intentionalFaceContact ? "contact" : "clearance") : "n/a"} · penalty F/H/T {arm.spatial.facePenalty.toFixed(2)}/{arm.spatial.headCollisionPenalty.toFixed(2)}/{arm.spatial.torsoCollisionPenalty.toFixed(2)}</small><br /></>}
            <strong>{side}</strong>: upper <em>{arm.segmentLossState.upper}</em> · lower <em>{arm.segmentLossState.lower}</em><br />
            elbow {arm.elbowInference.source} · pole {arm.poleSource}<br />
            stability U/L {motionDiagnostics.armStability[side].upperStaticMode ? "STATIC" : "moving"}/{motionDiagnostics.armStability[side].lowerStaticMode ? "STATIC" : "moving"}
            {" · velocity "}{motionDiagnostics.armStability[side].upperAngularVelocityRadiansPerSecond?.toFixed(2) ?? "—"}/{motionDiagnostics.armStability[side].lowerAngularVelocityRadiansPerSecond?.toFixed(2) ?? "—"} rad/s<br />
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
      <article><h2>Avatar self-collision</h2>
        <p>Runtime: <strong>{selfCollision?.enabled ? selfCollision.mode : "off"}</strong> · inter-arm {selfCollision?.interArm.length ?? 0}</p>
        <p>Final raw-bone FK: left {selfCollision?.rendered?.left.length??0} · right {selfCollision?.rendered?.right.length??0} · inter-arm {selfCollision?.rendered?.interArm.length??0}</p>
        <p>Fingertip: {selfCollision?.fingertip?.reason??"off"} · pairs {selfCollision?.fingertip?.pairs.length??0}</p>
        <pre>{JSON.stringify({finalContactErrors:selfCollision?.rendered?.contactErrors,finalFingertipGaps:selfCollision?.rendered?.fingertipGaps,fingertip:selfCollision?.fingertip},null,2)}</pre>
        {(["left", "right"] as const).map((side) => {
          const value = selfCollision?.[side];
          return <p key={side}><strong>{side}</strong>: {value ? `${value.reason} · baseline ${value.baselinePreserved ? "preserved" : "corrected"} · before ${value.contactsBefore.length} · after ${value.contactsAfter.length}` : "—"}
            {value?.contactsBefore[0] && <><br /><small>{value.contactsBefore[0].armPart} → {value.contactsBefore[0].bodyPart} · signed distance {value.contactsBefore[0].signedDistance.toFixed(3)} · penetration {value.contactsBefore[0].penetrationDepth.toFixed(3)} · normal {vector(value.contactsBefore[0].surfaceNormal)}</small></>}
          </p>;
        })}
      </article>

    </section>
  <MotionReplayPanel recorder={motionRecorderRef.current} metadata={{avatarModelId,poseModel,parallelHands,poseGuidedHands,adaptiveHandConfidence,poseDepthConditioningEnabled,handExecution:trackingMetrics?.handExecution??null,handInputMode:trackingMetrics?.handInputMode??null,handConfidenceMode:trackingMetrics?.handConfidenceMode??null,handWorkerFallback:trackingMetrics?.handWorkerFallback??null,simulatedLoss,fingertipContactEnabled,dofConstraintsEnabled,bodyDepthBarrierEnabled,depthFusionEnabled,bimanualPalmAssistEnabled,rigEndpointEnabled,elbowBranchSwitchEnabled,handConditioningEnabled,processorArmTemporal,filtered,constraints,handTwistEnabled,continuousFingerEnabled,contactCorrectionEnabled,faceContactResearch,rigProfile:rendererRef.current?.getRigProfile()??null,fingerRig,upperBodyRigProfile:rendererRef.current?.getUpperBodyRigProfile()??null}} onReplay={playMotionReplay} onStop={stopMotionReplay} />
    </main>;
}
