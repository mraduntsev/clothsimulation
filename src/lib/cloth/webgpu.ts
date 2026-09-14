export type GpuContext = {
  adapter: GPUAdapter;
  device: GPUDevice;
  context: GPUCanvasContext;
  format: GPUTextureFormat;
  sampleCount: 1 | 4;
};

/**
 * Acquire adapter + device FIRST, then bind the canvas. Calling
 * `getContext("webgpu")` locks the canvas against WebGL, so we only do it
 * once a device actually exists. That lets the CPU/WebGL fallback still
 * claim the same canvas if the adapter request fails.
 */
export async function createGpuContext(canvas: HTMLCanvasElement): Promise<GpuContext> {
  if (!navigator.gpu) {
    throw new GpuUnavailableError(
      "WebGPU не поддерживается в этом браузере. Нужен Chrome 113+, Edge 113+, Safari 18+ или Firefox 141+.",
    );
  }
  const adapter = await navigator.gpu.requestAdapter({ powerPreference: "high-performance" });
  if (!adapter) {
    throw new GpuUnavailableError(
      "Не удалось получить GPU-адаптер. Проверьте, что WebGPU включён и аппаратное ускорение активно.",
    );
  }
  let device: GPUDevice;
  try {
    device = await adapter.requestDevice({ label: "pbd-cloth-device" });
  } catch {
    throw new GpuUnavailableError("GPU-устройство отклонило requestDevice.");
  }
  device.addEventListener("uncapturederror", (ev) => {
    console.error("[WebGPU]", (ev as GPUUncapturedErrorEvent).error);
  });

  const context = canvas.getContext("webgpu");
  if (!context) {
    device.destroy();
    throw new GpuUnavailableError("Canvas не отдал контекст WebGPU.");
  }
  const format = navigator.gpu.getPreferredCanvasFormat();
  context.configure({
    device,
    format,
    alphaMode: "opaque",
    usage: GPUTextureUsage.RENDER_ATTACHMENT,
  });

  // 4× MSAA is required by the spec for renderable color formats; fall back
  // if a particular adapter rejects the texture.
  let sampleCount: 1 | 4 = 4;
  try {
    device
      .createTexture({
        size: [4, 4],
        format,
        sampleCount: 4,
        usage: GPUTextureUsage.RENDER_ATTACHMENT,
      })
      .destroy();
  } catch {
    sampleCount = 1;
  }

  return { adapter, device, context, format, sampleCount };
}

export class GpuUnavailableError extends Error {
  override name = "GpuUnavailableError";
}

export function align256(bytes: number): number {
  return Math.ceil(bytes / 256) * 256;
}

export function dispatchGroups(count: number, workgroup = 64): number {
  return Math.max(1, Math.ceil(count / workgroup));
}
