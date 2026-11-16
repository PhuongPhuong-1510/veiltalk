import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

const GLB_MAGIC = 0x46546c67;
const JSON_CHUNK = 0x4e4f534a;
const BIN_CHUNK = 0x004e4942;
const MAX_TEXTURE_SIZE = 512;
const JPEG_QUALITY = 78;

const projectRoot = path.resolve(import.meta.dirname, "..");
const sourceDirectory = path.join(projectRoot, "public", "models", "avatars");
const outputDirectory = path.join(projectRoot, "public", "models", "avatars-preview");

const align4 = (value) => (value + 3) & ~3;
const mb = (bytes) => `${(bytes / 1024 / 1024).toFixed(2)} MB`;

function parseGlb(file) {
  if (file.readUInt32LE(0) !== GLB_MAGIC || file.readUInt32LE(4) !== 2) {
    throw new Error("Only binary VRM/GLB version 2 is supported");
  }
  let offset = 12;
  let json = null;
  let binary = null;
  while (offset + 8 <= file.length) {
    const byteLength = file.readUInt32LE(offset);
    const type = file.readUInt32LE(offset + 4);
    const data = file.subarray(offset + 8, offset + 8 + byteLength);
    if (type === JSON_CHUNK) json = JSON.parse(data.toString("utf8").replace(/[\u0000\u0020]+$/u, ""));
    if (type === BIN_CHUNK) binary = data;
    offset += 8 + byteLength;
  }
  if (!json || !binary) throw new Error("VRM does not contain JSON and BIN chunks");
  return { json, binary };
}

async function optimizeImage(input, mimeType) {
  const pipeline = sharp(input, { failOn: "none" });
  const metadata = await pipeline.metadata();
  if (!metadata.width || !metadata.height) return input;
  pipeline.resize({
    width: MAX_TEXTURE_SIZE,
    height: MAX_TEXTURE_SIZE,
    fit: "inside",
    withoutEnlargement: true,
  });
  if (mimeType === "image/jpeg") pipeline.jpeg({ quality: JPEG_QUALITY, mozjpeg: true });
  else if (mimeType === "image/png") pipeline.png({ compressionLevel: 9, adaptiveFiltering: true });
  else return input;
  const output = await pipeline.toBuffer();
  return output.length < input.length ? output : input;
}

function createGlb(json, binary) {
  const jsonData = Buffer.from(JSON.stringify(json));
  const paddedJson = Buffer.alloc(align4(jsonData.length), 0x20);
  jsonData.copy(paddedJson);
  const paddedBinary = Buffer.alloc(align4(binary.length));
  binary.copy(paddedBinary);
  const totalLength = 12 + 8 + paddedJson.length + 8 + paddedBinary.length;
  const output = Buffer.alloc(totalLength);
  output.writeUInt32LE(GLB_MAGIC, 0);
  output.writeUInt32LE(2, 4);
  output.writeUInt32LE(totalLength, 8);
  output.writeUInt32LE(paddedJson.length, 12);
  output.writeUInt32LE(JSON_CHUNK, 16);
  paddedJson.copy(output, 20);
  const binHeader = 20 + paddedJson.length;
  output.writeUInt32LE(paddedBinary.length, binHeader);
  output.writeUInt32LE(BIN_CHUNK, binHeader + 4);
  paddedBinary.copy(output, binHeader + 8);
  return output;
}

async function buildPreview(fileName) {
  const sourcePath = path.join(sourceDirectory, fileName);
  const source = await readFile(sourcePath);
  const { json, binary } = parseGlb(source);
  const vrmExtensionSignature = JSON.stringify(json.extensions ?? {});
  const replacements = new Map();
  let optimizedTextureCount = 0;

  for (const image of json.images ?? []) {
    if (!Number.isInteger(image.bufferView) || !["image/png", "image/jpeg"].includes(image.mimeType)) continue;
    const view = json.bufferViews?.[image.bufferView];
    if (!view || (view.buffer ?? 0) !== 0) continue;
    const start = view.byteOffset ?? 0;
    const original = binary.subarray(start, start + view.byteLength);
    const optimized = await optimizeImage(original, image.mimeType);
    if (optimized.length < original.length) {
      replacements.set(image.bufferView, optimized);
      optimizedTextureCount += 1;
    }
  }

  const chunks = [];
  let binaryLength = 0;
  for (let index = 0; index < (json.bufferViews?.length ?? 0); index += 1) {
    const view = json.bufferViews[index];
    if ((view.buffer ?? 0) !== 0) continue;
    const originalStart = view.byteOffset ?? 0;
    const data = replacements.get(index) ?? binary.subarray(originalStart, originalStart + view.byteLength);
    binaryLength = align4(binaryLength);
    view.byteOffset = binaryLength;
    view.byteLength = data.length;
    chunks.push({ offset: binaryLength, data });
    binaryLength += data.length;
  }
  const rebuiltBinary = Buffer.alloc(align4(binaryLength));
  for (const chunk of chunks) chunk.data.copy(rebuiltBinary, chunk.offset);
  json.buffers[0].byteLength = rebuiltBinary.length;

  const preview = createGlb(json, rebuiltBinary);
  const validated = parseGlb(preview);
  if (JSON.stringify(validated.json.extensions ?? {}) !== vrmExtensionSignature) {
    throw new Error(`${fileName}: VRM extensions changed while building preview`);
  }
  for (const view of validated.json.bufferViews ?? []) {
    if ((view.buffer ?? 0) === 0 && (view.byteOffset ?? 0) + view.byteLength > validated.binary.length) {
      throw new Error(`${fileName}: bufferView exceeds rebuilt BIN chunk`);
    }
  }
  for (const image of validated.json.images ?? []) {
    if (!Number.isInteger(image.bufferView)) continue;
    const view = validated.json.bufferViews[image.bufferView];
    const start = view.byteOffset ?? 0;
    await sharp(validated.binary.subarray(start, start + view.byteLength), { failOn: "error" }).metadata();
  }
  await writeFile(path.join(outputDirectory, fileName), preview);
  return { sourceBytes: source.length, previewBytes: preview.length, optimizedTextureCount };
}

await mkdir(outputDirectory, { recursive: true });
const files = (await readdir(sourceDirectory)).filter((name) => name.toLowerCase().endsWith(".vrm")).sort();
let sourceTotal = 0;
let previewTotal = 0;
for (const fileName of files) {
  const result = await buildPreview(fileName);
  sourceTotal += result.sourceBytes;
  previewTotal += result.previewBytes;
  const savedPercent = Math.round((1 - result.previewBytes / result.sourceBytes) * 100);
  console.log(`${fileName}: ${mb(result.sourceBytes)} -> ${mb(result.previewBytes)} (-${savedPercent}%, ${result.optimizedTextureCount} textures)`);
}
console.log(`Total: ${mb(sourceTotal)} -> ${mb(previewTotal)} (-${Math.round((1 - previewTotal / sourceTotal) * 100)}%)`);
