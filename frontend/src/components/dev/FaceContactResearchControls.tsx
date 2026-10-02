import { FACE_CONTACT_ABLATIONS, type FaceContactResearchOptions } from "../../lib/avatar-motion/faceContactResearch";

const labels: Record<keyof FaceContactResearchOptions, string> = {
  headSurface: "Vùng mặt nhiều landmark / tư thế đầu",
  jointProbeSelection: "Chọn lòng, cạnh tay theo hướng tiếp xúc",
  registeredDepth: "Đăng ký độ sâu và kiểm độ bất định",
  meshSurface: "Bề mặt da avatar thay proxy đầu",
  finalRefinement: "Hiệu chỉnh cuối có giới hạn / rollback",
  indexTip: "Ngón trỏ chạm mặt (thử nghiệm riêng)",
};
export function FaceContactResearchControls({ value, onChange, capability }: {
  value: FaceContactResearchOptions; onChange: (value: FaceContactResearchOptions) => void; capability: unknown;
}) {
  return <fieldset><legend>Nghiên cứu tiếp xúc tay–mặt</legend>
    <p>Bật AR9 shadow để quan sát; bật Apply AR9 correction để chỉnh avatar. Chọn bản kết hợp hoặc bật từng cơ chế để so cùng replay.</p>
    <select aria-label="Biến thể nghiên cứu contact" value="" onChange={event => { const preset = FACE_CONTACT_ABLATIONS.find(p => p.name === event.target.value); if (preset) onChange({ ...preset.options }); }}>
      <option value="">Chọn cấu hình thử…</option>{FACE_CONTACT_ABLATIONS.map(p => <option key={p.name}>{p.name}</option>)}
    </select>
    {(Object.keys(labels) as Array<keyof FaceContactResearchOptions>).map(key => <label key={key}><input type="checkbox" checked={value[key]} onChange={event => onChange({ ...value, [key]: event.target.checked })} />{labels[key]}</label>)}
    <details><summary>Bề mặt mặt của avatar đang dùng</summary><pre>{JSON.stringify(capability, null, 2)}</pre></details>
  </fieldset>;
}
