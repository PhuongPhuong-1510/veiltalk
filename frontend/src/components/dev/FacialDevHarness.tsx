import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AvatarCanvas } from "../avatar/AvatarCanvas";
import type { AvatarRenderer } from "../../lib/avatar-renderer/avatarRenderer";
import type { FacialCapabilityManifest, FacialChannelCapability } from "../../lib/avatar-renderer/facialCapability";
import { DEFAULT_DEV_AVATAR_MODEL_ID, DEV_AVATAR_MODELS, getDevAvatarModel } from "./devAvatarModels";
import "./facialDevHarness.css";

type PreviewKind = "expression" | "raw-morph";
interface PreviewSelection { kind: PreviewKind; name: string }

const encodeSelection = (selection: PreviewSelection) => JSON.stringify(selection);
const decodeSelection = (value: string): PreviewSelection | null => {
  try {
    const parsed = JSON.parse(value) as Partial<PreviewSelection>;
    return (parsed.kind === "expression" || parsed.kind === "raw-morph") && typeof parsed.name === "string"
      ? { kind: parsed.kind, name: parsed.name }
      : null;
  } catch { return null; }
};

const statusLabel: Record<FacialChannelCapability["status"], string> = {
  bound: "VRM bind thật",
  "zero-bind": "Có tên, bind = 0",
  "raw-candidate": "Raw candidate (DEV)",
  unsupported: "Không hỗ trợ",
};

export default function FacialDevHarness() {
  const rendererRef = useRef<AvatarRenderer | null>(null);
  const requestIdRef = useRef(0);
  const [modelId, setModelId] = useState(DEFAULT_DEV_AVATAR_MODEL_ID);
  const [manifest, setManifest] = useState<FacialCapabilityManifest | null>(null);
  const [selectionValue, setSelectionValue] = useState("");
  const [weight, setWeight] = useState(0);
  const [zoom, setZoom] = useState(3.2);
  const [verticalOffset, setVerticalOffset] = useState(.34);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadModel = useCallback(async (renderer: AvatarRenderer, nextModelId: string) => {
    const model = getDevAvatarModel(nextModelId);
    if (!model) { setError(`Không tìm thấy DEV model: ${nextModelId}`); return; }
    const requestId = ++requestIdRef.current;
    renderer.clearDevFacialPreview();
    setLoading(true); setError(null); setManifest(null); setSelectionValue(""); setWeight(0);
    try {
      const capability = await renderer.loadModel(model.url, { licenseStatus: "unknown" });
      if (!capability || rendererRef.current !== renderer || requestIdRef.current !== requestId) return;
      const nextManifest = renderer.getFacialCapability();
      if (!nextManifest) { setError("Model đã tải nhưng không tạo được facial capability manifest."); return; }
      setManifest(nextManifest);
      const firstBound = Object.values(nextManifest.standard).find((entry) => entry.status === "bound" && entry.expressionName);
      if (firstBound?.expressionName) setSelectionValue(encodeSelection({ kind: "expression", name: firstBound.expressionName }));
    } catch (reason) {
      if (rendererRef.current === renderer && requestIdRef.current === requestId) setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      if (rendererRef.current === renderer && requestIdRef.current === requestId) setLoading(false);
    }
  }, []);

  const attachRenderer = useCallback((renderer: AvatarRenderer) => {
    rendererRef.current = renderer;
    renderer.setSmoothing(false);
    renderer.setZoom(zoom);
    renderer.setVerticalOffset(verticalOffset);
    void loadModel(renderer, modelId);
  }, [loadModel, modelId, verticalOffset, zoom]);

  const detachRenderer = useCallback((renderer: AvatarRenderer) => {
    if (rendererRef.current !== renderer) return;
    ++requestIdRef.current;
    rendererRef.current = null;
  }, []);

  useEffect(() => { rendererRef.current?.setZoom(zoom); }, [zoom]);
  useEffect(() => { rendererRef.current?.setVerticalOffset(verticalOffset); }, [verticalOffset]);
  useEffect(() => {
    const renderer = rendererRef.current;
    const selection = decodeSelection(selectionValue);
    if (!renderer || !selection) { renderer?.clearDevFacialPreview(); return; }
    renderer.setDevFacialPreview(selection.kind, selection.name, weight);
  }, [selectionValue, weight]);

  const expressionOptions = useMemo(() => manifest
    ? Object.entries(manifest.standard)
      .filter(([, entry]) => entry.expressionName)
      .map(([semantic, entry]) => ({ semantic, name: entry.expressionName!, status: entry.status }))
    : [], [manifest]);

  function changeModel(nextModelId: string) {
    setModelId(nextModelId);
    const renderer = rendererRef.current;
    if (renderer) void loadModel(renderer, nextModelId);
  }

  function resetPreview() {
    setWeight(0);
    rendererRef.current?.clearDevFacialPreview();
  }

  function downloadManifest() {
    if (!manifest) return;
    const blob = new Blob([JSON.stringify(manifest, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url; link.download = `${modelId}-facial-capability.json`; link.click();
    URL.revokeObjectURL(url);
  }

  return <main className="facial-dev">
    <header>
      <div><strong>DEV ONLY · LOCAL ONLY</strong><h1>F0 Facial Capability Lab</h1></div>
      <p>Thử từng VRM expression/raw morph tại máy. Không bật webcam, không upload ảnh hoặc manifest.</p>
    </header>

    {error && <p className="facial-dev-error" role="alert">{error}</p>}

    <section className="facial-dev-controls">
      <label>Avatar model
        <select value={modelId} onChange={(event) => changeModel(event.target.value)} disabled={loading}>
          {DEV_AVATAR_MODELS.map((model) => <option key={model.id} value={model.id}>{model.label}</option>)}
        </select>
      </label>
      <label>Kênh thử
        <select value={selectionValue} onChange={(event) => { setSelectionValue(event.target.value); setWeight(0); }} disabled={!manifest || loading}>
          <option value="">— chọn kênh —</option>
          <optgroup label="VRM expressions">
            {expressionOptions.map((option) => <option key={`expression:${option.semantic}`} value={encodeSelection({ kind: "expression", name: option.name })}>
              {option.semantic} → {option.name} ({statusLabel[option.status]})
            </option>)}
          </optgroup>
          <optgroup label="Raw morphs — chỉ DEV">
            {manifest?.rawMorphTargets.map((name) => <option key={`raw:${name}`} value={encodeSelection({ kind: "raw-morph", name })}>{name}</option>)}
          </optgroup>
        </select>
      </label>
      <label>Weight
        <input type="range" min="0" max="1" step="0.01" value={weight} onChange={(event) => setWeight(Number(event.target.value))} disabled={!selectionValue} />
        <output>{weight.toFixed(2)}</output>
      </label>
      <button onClick={resetPreview}>Reset expression</button>
      <button onClick={downloadManifest} disabled={!manifest}>Tải manifest JSON</button>
      <label>Zoom <input type="range" min="1" max="5" step="0.05" value={zoom} onChange={(event) => setZoom(Number(event.target.value))} /> {zoom.toFixed(2)}x</label>
      <label>Vị trí dọc <input type="range" min="-.1" max=".6" step=".01" value={verticalOffset} onChange={(event) => setVerticalOffset(Number(event.target.value))} /> {verticalOffset.toFixed(2)}</label>
    </section>

    <section className="facial-dev-workspace">
      <article className="facial-dev-stage">
        <AvatarCanvas onReady={attachRenderer} onDispose={detachRenderer} onError={(reason) => setError(reason.message)} options={{ smoothing: false, onContextLost: (reason) => setError(reason.message) }} />
        {loading && <div className="facial-dev-loading">Đang tải model…</div>}
      </article>

      <article className="facial-dev-summary">
        <h2>Model capability</h2>
        {!manifest ? <p>Chưa có manifest.</p> : <>
          <p><strong>{getDevAvatarModel(modelId)?.label}</strong></p>
          <p>VRM {manifest.vrmVersion ?? "—"} · LookAt {manifest.lookAt.supported ? "có" : "không"} · eye bones L/R {manifest.lookAt.leftEyeBone ? "có" : "không"}/{manifest.lookAt.rightEyeBone ? "có" : "không"}</p>
          <p>Raw morph targets: {manifest.rawMorphTargets.length}</p>
          {manifest.warnings.map((warning) => <p className="facial-dev-warning" key={warning}>{warning}</p>)}
        </>}
      </article>
    </section>

    {manifest && <section className="facial-dev-tables">
      <article><h2>VRM standard channels</h2><CapabilityTable entries={manifest.standard} /></article>
      <article><h2>Advanced semantic candidates</h2><CapabilityTable entries={manifest.advanced} /></article>
    </section>}
  </main>;
}

function CapabilityTable({ entries }: { entries: Readonly<Record<string, FacialChannelCapability>> }) {
  return <div className="facial-table-wrap"><table>
    <thead><tr><th>Semantic</th><th>Trạng thái</th><th>Bind</th><th>Expression / raw candidates</th><th>Production</th></tr></thead>
    <tbody>{Object.entries(entries).map(([semantic, entry]) => <tr key={semantic}>
      <td>{semantic}</td><td data-status={entry.status}>{statusLabel[entry.status]}</td><td>{entry.bindCount}</td>
      <td>{entry.expressionName ?? (entry.rawMorphCandidates.join(", ") || "—")}</td><td>{entry.productionReady ? "Có" : "Chưa"}</td>
    </tr>)}</tbody>
  </table></div>;
}
