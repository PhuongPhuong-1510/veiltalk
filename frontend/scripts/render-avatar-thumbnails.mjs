import { spawn } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const frontendRoot = path.resolve(import.meta.dirname, "..");
const outputDirectory = path.join(frontendRoot, "public", "models", "avatar-thumbnails");
const rendererPage = path.join(frontendRoot, "avatar-thumbnail-renderer.html");
const port = 4187;
const baseUrl = `http://127.0.0.1:${port}`;
const models = Array.from({ length: 10 }, (_, index) => `reference-avatar-${index + 2}`);
const chromePaths = process.platform === "win32"
  ? [
      "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
      "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
    ]
  : ["google-chrome", "chromium", "chromium-browser"];

const pageSource = `<!doctype html>
<html><head><meta charset="UTF-8"><style>html,body{margin:0;background:transparent}canvas{display:block;width:512px;height:512px}</style></head>
<body><canvas id="portrait" width="512" height="512"></canvas><script type="module">
import { AmbientLight, Box3, Color, DirectionalLight, PerspectiveCamera, Quaternion, Scene, SRGBColorSpace, Vector3, WebGLRenderer } from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { VRMLoaderPlugin, VRMUtils } from "@pixiv/three-vrm";
import { createRigProfile } from "/src/lib/avatar-renderer/modelLoader.ts";
import { buildIdleArmPose } from "/src/lib/avatar-motion/idleArmPose.ts";
window.__thumbnail = { status: "loading" };
try {
  const id = new URLSearchParams(location.search).get("model");
  const loader = new GLTFLoader();
  loader.register((parser) => new VRMLoaderPlugin(parser, { autoUpdateHumanBones: true }));
  const gltf = await loader.loadAsync(\`/models/avatars-preview/\${id}.vrm\`);
  const vrm = gltf.userData.vrm;
  if (vrm?.meta.metaVersion === "0") VRMUtils.rotateVRM0(vrm);
  gltf.scene.updateMatrixWorld(true);
  const bones = {};
  for (const semantic of ["head","neck","chest","upperChest","spine","hips","leftShoulder","leftUpperArm","leftLowerArm","leftHand","rightShoulder","rightUpperArm","rightLowerArm","rightHand"]) {
    const bone = vrm?.humanoid.getNormalizedBoneNode(semantic); if (bone) bones[semantic] = bone;
  }
  const profile = createRigProfile(1, id, bones);
  if (profile) for (const side of ["left", "right"]) {
    const pose = buildIdleArmPose(profile, side);
    for (const segment of ["UpperArm", "LowerArm"]) {
      const name = side + segment, joint = profile.joints[name], delta = segment === "UpperArm" ? pose.upper : pose.lower;
      bones[name]?.quaternion.copy(new Quaternion(joint.restLocalRotation.x,joint.restLocalRotation.y,joint.restLocalRotation.z,joint.restLocalRotation.w))
        .multiply(new Quaternion(delta.x,delta.y,delta.z,delta.w)).normalize();
    }
  }
  vrm?.update(0);
  gltf.scene.updateMatrixWorld(true);
  const box = new Box3().setFromObject(gltf.scene);
  const size = box.getSize(new Vector3());
  const center = box.getCenter(new Vector3());
  const head = vrm?.humanoid.getNormalizedBoneNode("head");
  const headPosition = head?.getWorldPosition(new Vector3()) ?? new Vector3(center.x, center.y + size.y * .34, center.z);
  const target = new Vector3(headPosition.x, headPosition.y - size.y * .12, headPosition.z);
  const scene = new Scene(); scene.add(gltf.scene);
  scene.add(new AmbientLight(0xffffff, 1.3));
  const key = new DirectionalLight(0xfff8ff, 1.8); key.position.set(2, 3, 4); scene.add(key);
  const fill = new DirectionalLight(0xc9b5ff, .9); fill.position.set(-2, 1.5, 2); scene.add(fill);
  const rim = new DirectionalLight(0x9d75d1, .7); rim.position.set(-2, 2, -3); scene.add(rim);
  const camera = new PerspectiveCamera(27, 1, .01, 100);
  const portraitHeight = size.y * .46;
  const distance = portraitHeight / (2 * Math.tan(camera.fov * Math.PI / 360)) * 1.06;
  camera.position.set(target.x, target.y + size.y * .015, target.z + distance);
  camera.lookAt(target); camera.updateProjectionMatrix();
  const renderer = new WebGLRenderer({ canvas: document.querySelector("#portrait"), alpha: true, antialias: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(1); renderer.setSize(512, 512, false); renderer.outputColorSpace = SRGBColorSpace;
  renderer.setClearColor(new Color(0x000000), 0); renderer.render(scene, camera);
  await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  renderer.render(scene, camera);
  window.__thumbnail = { status: "ready", data: renderer.domElement.toDataURL("image/png") };
} catch (error) { window.__thumbnail = { status: "error", message: error?.stack ?? String(error) }; }
</script></body></html>`;

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function waitForJson(url, timeoutMs = 30000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try { const response = await fetch(url); if (response.ok) return response.json(); } catch {}
    await delay(200);
  }
  throw new Error(`Timed out waiting for ${url}`);
}
async function waitForHttp(url, timeoutMs = 30000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try { const response = await fetch(url); if (response.ok) return; } catch {}
    await delay(200);
  }
  throw new Error(`Timed out waiting for ${url}`);
}
function connectCdp(url) {
  const socket = new WebSocket(url); let id = 0; const pending = new Map();
  socket.onmessage = ({ data }) => { const message = JSON.parse(data); if (message.id && pending.has(message.id)) { pending.get(message.id)(message); pending.delete(message.id); } };
  const opened = new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
  return { opened, socket, send: async (method, params = {}) => { await opened; const callId = ++id; const result = new Promise((resolve) => pending.set(callId, resolve)); socket.send(JSON.stringify({ id: callId, method, params })); return result; } };
}
async function findChrome() {
  const { access } = await import("node:fs/promises");
  for (const candidate of chromePaths) { try { await access(candidate); return candidate; } catch {} }
  return chromePaths[0];
}

await mkdir(outputDirectory, { recursive: true });
await writeFile(rendererPage, pageSource, "utf8");
const userDataDirectory = await mkdtemp(path.join(tmpdir(), "kokoro-avatar-thumbnails-"));
const vite = spawn(process.execPath, [path.join(frontendRoot, "node_modules", "vite", "bin", "vite.js"), "--host", "127.0.0.1", "--port", String(port)], { cwd: frontendRoot, stdio: "ignore" });
let browser;
try {
  await waitForHttp(baseUrl);
  browser = spawn(await findChrome(), ["--headless=new", `--remote-debugging-port=${port + 1}`, `--user-data-dir=${userDataDirectory}`, "--no-first-run", "--disable-default-apps", "about:blank"], { stdio: "ignore" });
  await waitForJson(`http://127.0.0.1:${port + 1}/json/version`);
  const target = await (await fetch(`http://127.0.0.1:${port + 1}/json/new?${encodeURIComponent(baseUrl + "/avatar-thumbnail-renderer.html")}`, { method: "PUT" })).json();
  const cdp = connectCdp(target.webSocketDebuggerUrl); await cdp.opened; await cdp.send("Page.enable");
  for (const model of models) {
    await cdp.send("Page.navigate", { url: `${baseUrl}/avatar-thumbnail-renderer.html?model=${model}` });
    let result;
    for (let attempt = 0; attempt < 300; attempt += 1) {
      const response = await cdp.send("Runtime.evaluate", { expression: "window.__thumbnail", returnByValue: true });
      result = response.result?.result?.value;
      if (result?.status === "ready" || result?.status === "error") break;
      await delay(200);
    }
    if (result?.status !== "ready") throw new Error(`${model}: ${result?.message ?? "render timeout"}`);
    const png = Buffer.from(result.data.replace(/^data:image\/png;base64,/, ""), "base64");
    await writeFile(path.join(outputDirectory, `${model}.png`), png);
    console.log(`${model}.png (${Math.round(png.length / 1024)} KB)`);
  }
  cdp.socket.close();
} finally {
  browser?.kill(); vite.kill();
  await rm(rendererPage, { force: true });
  await delay(750);
  await rm(userDataDirectory, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 }).catch(() => {});
}
