// @vitest-environment happy-dom
import { act, useMemo } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TrackingPerformancePanel } from "./TrackingPerformancePanel";
import { AVATAR_TRACKING_CONFIG } from "../../lib/tracking/avatarTrackingConfig";
import { TrackingMetricsCollector } from "../../lib/tracking/trackingMetrics";
import { useTracking } from "../../lib/tracking/useTracking";
import type { TrackingPipelineOptions } from "../../lib/tracking/trackingPipeline";
const instances = vi.hoisted(() => [] as Array<{ options: TrackingPipelineOptions; dispose: ReturnType<typeof vi.fn> }>);
vi.mock("../../lib/tracking/trackingPipeline", () => ({ TrackingPipeline: class {
  options: TrackingPipelineOptions; dispose = vi.fn();
  constructor(options: TrackingPipelineOptions) { this.options = options; instances.push(this); }
} }));
let root: Root, container: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); instances.length = 0; vi.restoreAllMocks(); vi.unstubAllGlobals(); });
describe("tracking diagnostics and lifecycle", () => {
  it("keeps the pipeline alive through diagnostics rerenders, replacing it only for config changes", async () => {
    const onFrame = vi.fn();
    function Harness({ delegate, tick }: { delegate?: "CPU" | "GPU"; tick: number }) {
      const options = useMemo(() => ({ onFrame, handWorkerDelegate: delegate, experiments: AVATAR_TRACKING_CONFIG.experiments }), [delegate]);
      const pipeline = useTracking(options);
      return <span>{tick}:{pipeline ? "ready" : "loading"}</span>;
    }
    await act(async () => root.render(<Harness tick={0} />));
    for (let tick = 1; tick <= 5; tick++) await act(async () => root.render(<Harness tick={tick} />));
    expect(instances).toHaveLength(1); expect(instances[0].dispose).not.toHaveBeenCalled();
    await act(async () => root.render(<Harness delegate="CPU" tick={6} />));
    expect(instances).toHaveLength(2); expect(instances[0].dispose).toHaveBeenCalledOnce();
    expect(instances[1].options.handWorkerDelegate).toBe("CPU");
    await act(async () => root.render(null)); expect(instances[1].dispose).toHaveBeenCalledOnce();
  });
  it("requests boundary reset and exports explicit fallback invalidity, observations and version", async () => {
    const collector = new TrackingMetricsCollector(); collector.beginMeasurement(100);
    const metrics = { ...collector.snapshot(200, "GPU", "full"), handExecution: "main-thread" as const, handDelegate: "GPU" as const, handWorkerFallback: "CPU timeout" };
    const reset = vi.fn(() => true); let exported: Blob | null = null;
    vi.spyOn(URL, "createObjectURL").mockImplementation(blob => { exported = blob as Blob; return "blob:test"; });
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    await act(async () => root.render(<TrackingPerformancePanel metrics={metrics} onResetMeasurement={reset} context={{ strategy: "callback-ahead-v1", rendererRunning: true }} />));
    expect(container.textContent).toContain("Accepted Hands observation");
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("CPU timeout");
    const buttons = [...container.querySelectorAll("button")];
    await act(async () => buttons.find(button => button.textContent?.includes("Reset Measurement"))!.click());
    expect(reset).toHaveBeenCalledOnce();
    await act(async () => buttons.find(button => button.textContent?.includes("Tải metrics JSON"))!.click());
    const report = JSON.parse(await exported!.text());
    expect(report).toMatchObject({ phase: "tracking-performance", schemaVersion: 1, scenario: "still", benchmark: { validForControlledComparison: false, webcamQualityVerified: false }, metrics: { handExecution: "main-thread", handDelegate: "GPU", measurement: { id: 1 } } });
    expect(report.metrics.observations).toBeDefined();
  });
});
