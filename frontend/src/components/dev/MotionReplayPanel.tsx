import { useEffect, useState } from "react";
import { MOTION_SCENES, parseMotionRecording, type MotionRecorder, type MotionRecordingV1, type MotionScene } from "../../lib/avatar-motion/motionReplay";
import { compareMotionRecording, type MotionBenchmarkResult } from "../../lib/avatar-motion/motionBenchmark";
import { createSyntheticMotionRecording } from "../../lib/avatar-motion/syntheticMotionRecording";
import { compareFaceContactRecording, createFaceContactAnnotationTemplate, parseFaceContactAnnotations } from "../../lib/avatar-motion/faceContactEvaluation";

function download(value: unknown, name: string): void {
  const url = URL.createObjectURL(new Blob([JSON.stringify(value)], { type: "application/json" }));
  const link = document.createElement("a"); link.href = url; link.download = name; link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function MotionReplayPanel({ recorder, metadata, onReplay, onStop }: {
  recorder: MotionRecorder; metadata: Record<string, unknown>; onReplay: (recording: MotionRecordingV1) => void; onStop: () => void;
}) {
  const [scene, setScene] = useState<MotionScene>("static");
  const [count, setCount] = useState(0), [active, setActive] = useState(false);
  const [loaded, setLoaded] = useState<MotionRecordingV1 | null>(null);
  const [status, setStatus] = useState("Thu một cảnh để phát lại cùng dữ liệu với các công tắc khác nhau.");
  const [results, setResults] = useState<MotionBenchmarkResult[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [annotationJson,setAnnotationJson]=useState("");
  const [faceResults,setFaceResults]=useState<Awaited<ReturnType<typeof compareFaceContactRecording>>|null>(null);
  useEffect(() => { const id = window.setInterval(() => { setCount(recorder.count()); setActive(recorder.active); if(recorder.stoppedByLimit)setStatus("Đã dừng thu ở giới hạn dung lượng. Xuất file rồi thu cảnh tiếp theo."); }, 200); return () => window.clearInterval(id); }, [recorder]);
  const recording = () => loaded ?? recorder.snapshot();
  return <section className="motion-replay-panel">
    <h2>Thu cảnh và phát lại chuyển động</h2>
    <p>Chọn cảnh, giữ tư thế 10 giây hoặc thực hiện động tác chậm. File lưu trên máy của bạn; không tự gửi lên server.</p>
    <label>Cảnh <select value={scene} onChange={event => setScene(event.target.value as MotionScene)}>{MOTION_SCENES.map(value => <option key={value}>{value}</option>)}</select></label>
    <button disabled={busy || active} onClick={() => { setLoaded(createSyntheticMotionRecording(scene, metadata)); setResults(null); setStatus("Đã tạo mẫu hình học tổng hợp để kiểm tra pipeline; đây không phải dữ liệu webcam."); }}>Tạo mẫu không cần webcam</button>
    <button disabled={busy} onClick={() => { onStop(); setLoaded(null); setResults(null); recorder.start(scene, { ...metadata, experimentVersion: "xr-transfer-2026-10-02", sourceHash: import.meta.env.VITE_MOTION_SOURCE_HASH, hashScope: "server-start-or-build; restart after source edits", userAgent: navigator.userAgent, capturedConfig: metadata }); setActive(true); setStatus("Đang thu; chờ avatar ổn định và căn chỉnh neutral nếu cần trước khi thực hiện cảnh."); }}>Bắt đầu thu</button>
    <button onClick={() => { recorder.stop(); setActive(false); setStatus("Đã dừng thu."); }}>Dừng thu</button>
    <span>{active ? "Đang thu" : "Đã thu"}: {count} frame</span>
    <button onClick={() => { const value = recording(); if (value?.frames.length) download(value, `veiltalk-${value.scene}-${Date.now()}.json`); else setStatus("Chưa có frame để xuất."); }}>Xuất replay JSON</button>
    <label>Nạp replay <input type="file" accept="application/json,.json" disabled={busy} onChange={async event => {
      const file = event.target.files?.[0]; if (!file) return;
      try { if (file.size > 25_000_000) throw new Error("File vượt 25 MB."); const value = parseMotionRecording(await file.text()); setLoaded(value); setResults(null); setStatus(`Đã nạp ${value.frames.length} frame: ${value.scene}. Chọn cùng avatar/config trước khi phát lại.`); }
      catch (error) { setStatus(error instanceof Error ? error.message : "Không đọc được replay."); }
    }} /></label>
    <button disabled={busy} onClick={() => { const value = recording(); if (value?.frames.length) { recorder.stop(); onReplay(value); setStatus("Đang phát lại với avatar và công tắc hiện tại."); } else setStatus("Chưa có replay."); }}>Phát lại</button>
    <button onClick={() => { onStop(); setStatus("Đã dừng phát lại."); }}>Dừng phát lại</button>
    <button disabled={busy || active} onClick={() => {
      const value = recording(); if (!value?.frames.length) { setStatus("Chưa có replay."); return; }
      recorder.stop(); onStop(); setBusy(true); setStatus("Đang so A/B phần processor…");
      // Allow paint before the bounded offline comparison. Webcam capture is separate.
      window.setTimeout(() => { try { setResults(compareMotionRecording(value)); setStatus("Đã so A/B processor. Cần kiểm tra hình ảnh phát lại và độ trễ render trước khi bật mặc định."); }
      catch (error) { setStatus(error instanceof Error ? error.message : "Benchmark lỗi."); } finally { setBusy(false); } }, 0);
    }}>So A/B tracking tay</button>
    {results && <><button onClick={() => download({ version: 1, scene: recording()?.scene, metadata: recording()?.metadata, results }, `veiltalk-motion-ab-${Date.now()}.json`)}>Xuất kết quả A/B</button><pre>{JSON.stringify(results, null, 2)}</pre></>}
    <details><summary>Nghiên cứu tiếp xúc tay–mặt: nhãn và ablation</summary>
      <p>Nhãn dùng thời gian atMs trong replay, trái/phải theo người. Chỉ đặt verified khi đã xác nhận thao tác; vùng không chắc chắn giữ contact=null, certainty=uncertain. Gộp mỗi thao tác liên tục thành một khoảng. Mã người và phiên dùng để chia dữ liệu, tránh kiểm thử lại trên người đã tinh chỉnh.</p>
      <button disabled={busy||active} onClick={async()=>{const value=recording();if(!value?.frames.length){setStatus("Chưa có replay.");return;}try{setAnnotationJson(JSON.stringify(await createFaceContactAnnotationTemplate(value),null,2));setFaceResults(null);}catch(e){setStatus(String(e));}}}>Tạo mẫu nhãn cho replay</button>
      <label>Nạp nhãn JSON <input type="file" accept=".json" disabled={busy} onChange={async e=>{const file=e.target.files?.[0];if(!file)return;try{if(file.size>1_000_000)throw new Error("Nhãn vượt 1 MB.");const text=await file.text();parseFaceContactAnnotations(text);setAnnotationJson(text);setFaceResults(null);}catch(reason){setStatus(String(reason));}}}/></label>
      <label>Nhãn và khoảng thời gian <textarea rows={14} value={annotationJson} disabled={busy} onChange={e=>{setAnnotationJson(e.target.value);setFaceResults(null);}}/></label>
      <button disabled={busy||!annotationJson} onClick={()=>{try{download(parseFaceContactAnnotations(annotationJson),"veiltalk-face-contact-labels.json");}catch(e){setStatus(String(e));}}}>Xuất nhãn</button>
      <button disabled={busy||active} onClick={async()=>{const value=recording();if(!value?.frames.length){setStatus("Chưa có replay.");return;}setBusy(true);onStop();recorder.stop();setStatus("Đang chạy các biến thể contact…");try{const labels=annotationJson.trim()?parseFaceContactAnnotations(annotationJson):null;setFaceResults(await compareFaceContactRecording(value,labels));setStatus("Đã so contact. Chưa có nhãn verified thì chỉ có diagnostics và timing, không có điểm độ chính xác.");}catch(e){setStatus(e instanceof Error?e.message:String(e));}finally{setBusy(false);}}}>So các thuật toán chạm mặt</button>
      {faceResults&&<><button onClick={()=>download(faceResults,`veiltalk-face-contact-ab-${Date.now()}.json`)}>Xuất kết quả nghiên cứu</button><pre>{JSON.stringify(faceResults,null,2)}</pre></>}
    </details>
    <p role="status">{status}</p>
  </section>;
}
