import type { ConfiguredDelegate } from "../../lib/tracking/mediaPipeRuntime";
import { TRACKING_EXPERIMENT_PRESETS } from "./trackingExperimentPresets";

export function TrackingExperimentControls({ delegate, strategy, disabled, onDelegateChange, onStrategyChange }: {
  delegate: ConfiguredDelegate | undefined;
  strategy: string;
  disabled: boolean;
  onDelegateChange: (delegate: ConfiguredDelegate | undefined) => void;
  onStrategyChange: (strategy: string) => void;
}) {
  const preset = TRACKING_EXPERIMENT_PRESETS.find(item => item.id === strategy);
  return <fieldset className="tracking-experiment-controls" disabled={disabled}>
    <legend>Phase B — cấu hình thử nghiệm</legend>
    <label>Hands Worker delegate <select aria-label="Hands Worker delegate" value={delegate ?? "inherit"} onChange={e => onDelegateChange(e.target.value === "inherit" ? undefined : e.target.value as ConfiguredDelegate)}><option value="inherit">Inherit (baseline)</option><option value="GPU">GPU</option><option value="CPU">CPU</option></select></label>
    <label>Tracking strategy <select aria-label="Tracking strategy" value={strategy} onChange={e => onStrategyChange(e.target.value)}>{TRACKING_EXPERIMENT_PRESETS.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label>
    <p>{preset?.description} Dừng tracking trước khi đổi cấu hình. CPU/experimental chưa được nghiệm thu bằng webcam.</p>
  </fieldset>;
}
