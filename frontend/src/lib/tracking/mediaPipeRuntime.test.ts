import { describe, expect, it, vi } from "vitest";
import { MediaPipeRuntime, type MediaPipeRuntimeDependencies } from "./mediaPipeRuntime";

function task() { return { detectForVideo: vi.fn(), close: vi.fn() }; }

describe("MediaPipeRuntime", () => {
  it("uses one fileset for all tasks and retains models until dispose", async () => {
    const fileset = { wasmLoaderPath: "/loader", wasmBinaryPath: "/binary" };
    const face = task(); const hands = task(); const pose = task();
    const dependencies = {
      resolveFileset: vi.fn().mockResolvedValue(fileset),
      createFace: vi.fn().mockResolvedValue(face),
      createHands: vi.fn().mockResolvedValue(hands),
      createPose: vi.fn().mockResolvedValue(pose),
    } as unknown as MediaPipeRuntimeDependencies;
    const runtime = new MediaPipeRuntime(dependencies);
    await runtime.initialize();
    await runtime.initialize();
    expect(dependencies.resolveFileset).toHaveBeenCalledTimes(1);
    expect(dependencies.createFace).toHaveBeenCalledWith(fileset, expect.anything());
    expect(dependencies.createHands).toHaveBeenCalledWith(fileset, expect.anything());
    expect(dependencies.createPose).toHaveBeenCalledWith(fileset, expect.anything());
    expect(runtime.selectedDelegate).toBe("GPU");
    expect(face.close).not.toHaveBeenCalled();
    runtime.dispose();
    runtime.dispose();
    expect(face.close).toHaveBeenCalledTimes(1);
    expect(hands.close).toHaveBeenCalledTimes(1);
    expect(pose.close).toHaveBeenCalledTimes(1);
    await expect(runtime.initialize()).rejects.toThrow("dispose");
  });

  it("cleans partial GPU init and retries all tasks with CPU", async () => {
    const gpuFace = task(); const cpuFace = task(); const cpuHands = task(); const cpuPose = task();
    const createFace = vi.fn().mockResolvedValueOnce(gpuFace).mockResolvedValueOnce(cpuFace);
    const createHands = vi.fn().mockRejectedValueOnce(new Error("WebGL context")).mockResolvedValueOnce(cpuHands);
    const dependencies = {
      resolveFileset: vi.fn().mockResolvedValue({ wasmLoaderPath: "/loader", wasmBinaryPath: "/binary" }),
      createFace,
      createHands,
      createPose: vi.fn().mockResolvedValue(cpuPose),
    } as unknown as MediaPipeRuntimeDependencies;
    const runtime = new MediaPipeRuntime(dependencies);
    await runtime.initialize();
    expect(gpuFace.close).toHaveBeenCalledTimes(1);
    expect(runtime.selectedDelegate).toBe("CPU");
    expect(createFace.mock.calls[1][1].baseOptions.delegate).toBe("CPU");
    expect(createHands.mock.calls[1][1].baseOptions.delegate).toBe("CPU");
    runtime.dispose();
  });

  it("uses an explicit delegate and initializes only the selected task", async () => {
    const face = task();
    const createFace = vi.fn().mockResolvedValue(face);
    const dependencies = {
      resolveFileset: vi.fn().mockResolvedValue({ wasmLoaderPath: "/loader", wasmBinaryPath: "/binary" }),
      createFace,
      createHands: vi.fn(), createPose: vi.fn(),
    } as unknown as MediaPipeRuntimeDependencies;
    const runtime = new MediaPipeRuntime(dependencies, "CPU", { face: true, hands: false, pose: false });
    await runtime.initialize();
    expect(runtime.selectedDelegate).toBe("CPU");
    expect(createFace.mock.calls[0][1].baseOptions.delegate).toBe("CPU");
    expect(dependencies.createHands).not.toHaveBeenCalled();
    expect(dependencies.createPose).not.toHaveBeenCalled();
    runtime.dispose();
  });
});
