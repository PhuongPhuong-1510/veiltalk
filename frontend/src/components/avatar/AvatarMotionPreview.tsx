import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AvatarCanvas } from "./AvatarCanvas";
import { AvatarMotionProcessor } from "../../lib/avatar-motion/avatarMotionProcessor";
import { AvatarRenderer } from "../../lib/avatar-renderer/avatarRenderer";
import type { RawTrackingFrameV1 } from "../../lib/tracking/rawTrackingTypes";
import { useTracking } from "../../lib/tracking/useTracking";
import "./avatarMotionPreview.css";

/** Local preview uses the same processor/renderer in production builds, independently of DEV. */
export default function AvatarMotionPreview() {
  const videoRef=useRef<HTMLVideoElement>(null),rendererRef=useRef<AvatarRenderer|null>(null);
  const processorRef=useRef<AvatarMotionProcessor|null>(null);
  if(!processorRef.current)processorRef.current=new AvatarMotionProcessor({continuousFingerEnabled:true});
  const [renderer,setRenderer]=useState<AvatarRenderer|null>(null);
  const [modelUrl,setModelUrl]=useState("/models/avatars/reference-avatar-2.vrm");
  const [modelLabel,setModelLabel]=useState("Avatar thử nghiệm"),[ready,setReady]=useState(false);
  const [running,setRunning]=useState(false),[starting,setStarting]=useState(false);
  const [error,setError]=useState<string|null>(null),[status,setStatus]=useState("Đang tải avatar…");
  const onFrame=useCallback((frame:RawTrackingFrameV1)=>{const packet=processorRef.current?.process(frame);if(packet)rendererRef.current?.applyPose(packet);},[]);
  const onError=useCallback((reason:unknown)=>{setError(reason instanceof Error?reason.message:"Không thể theo dõi chuyển động.");setRunning(false);},[]);
  const options=useMemo(()=>({profile:"full-rate" as const,resolution:"720p" as const,delegate:"GPU" as const,tasks:{face:true,hands:true,pose:true},onFrame,onError}),[onFrame,onError]);
  const tracking=useTracking(options);
  const onReady=useCallback((value:AvatarRenderer)=>{rendererRef.current=value;setRenderer(value);},[]);
  const onDispose=useCallback((value:AvatarRenderer)=>{if(rendererRef.current===value)rendererRef.current=null;},[]);
  useEffect(()=>{
    if(!renderer)return;
    let cancelled=false;setReady(false);setError(null);setStatus("Đang tải avatar…");
    const processor=processorRef.current!;processor.setRigProfile(null);processor.setUpperBodyRigProfile(null);processor.setFingerRig(null);
    void renderer.loadModel(modelUrl,{licenseStatus:"unknown"}).then(report=>{
      if(cancelled||rendererRef.current!==renderer)return;
      const rig=renderer.getRigProfile();if(!report||!rig)throw new Error("Model cần có bộ xương humanoid và đủ xương cánh tay.");
      processor.setRigProfile(rig);processor.setUpperBodyRigProfile(renderer.getUpperBodyRigProfile());processor.setFingerRig(renderer.getFingerRig());processor.setFacialModelFingerprint(renderer.getFacialCapability()?.modelFingerprint??null);
      setReady(true);setStatus("Avatar sẵn sàng. Bật camera để thử chuyển động.");
    }).catch(reason=>{if(!cancelled)onError(reason);});
    return()=>{cancelled=true;};
  },[renderer,modelUrl,onError]);
  useEffect(()=>()=>{processorRef.current?.dispose();},[]);
  useEffect(()=>()=>{if(modelUrl.startsWith("blob:"))URL.revokeObjectURL(modelUrl);},[modelUrl]);
  async function toggleCamera(){
    if(!tracking||!videoRef.current||starting)return;
    if(running){tracking.stop();processorRef.current?.resetCameraTracking();setRunning(false);setStatus("Camera đã dừng.");return;}
    setStarting(true);setError(null);processorRef.current?.resetCameraTracking();
    try{await tracking.start(videoRef.current);setRunning(true);setStatus("Đang theo dõi. Để vai, khuỷu và hai bàn tay trong khung hình khi bắt đầu.");}
    catch(reason){onError(reason);}finally{setStarting(false);}
  }
  return <main className="avatar-motion-preview">
    <header><h1>Thử chuyển động avatar</h1><p>Camera được xử lý trên máy của bạn. Trang này không truyền video hoặc landmarks lên server.</p></header>
    <section className="motion-preview-stages"><div><AvatarCanvas onReady={onReady} onDispose={onDispose} onError={onError}/><p>{modelLabel}</p></div><div><video ref={videoRef} muted playsInline/><p>Hình ảnh camera</p></div></section>
    <section className="motion-preview-controls">
      <button disabled={!ready||!tracking||starting} onClick={()=>void toggleCamera()}>{starting?"Đang bật camera…":running?"Dừng camera":"Bật camera"}</button>
      <button disabled={!ready||!running} onClick={()=>{processorRef.current?.calibrateFaceNeutral();setStatus("Giữ mặt, thân và hai vai ở tư thế trung tính trong vài giây.");}}>Căn chỉnh tư thế trung tính</button>
      <label>Chọn avatar VRM trên máy <input type="file" accept=".vrm" disabled={starting} onChange={event=>{const file=event.target.files?.[0];if(file){setModelLabel(file.name);setModelUrl(URL.createObjectURL(file));}}}/></label>
    </section>
    <p role="status">{status}</p>{error&&<p role="alert">{error}</p>}
    <p>Thử giơ tay, xoay cổ tay, xòe/nắm ngón và che từng bàn tay trong thời gian ngắn. Các thử nghiệm contact và so A/B nằm ở trang kiểm tra chuyển động.</p>
    {import.meta.env.DEV&&<a href="/dev/avatar-renderer">Mở trang kiểm tra chuyển động và replay</a>}
  </main>;
}
