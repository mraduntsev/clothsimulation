import { CONFIG, type ClothBackend, type UiParams } from "./config";
import { OrbitCamera } from "./camera";
import { buildCloth } from "./cloth";
import { CpuSimulation } from "./cpu-simulation";
import { GlRenderer } from "./gl-renderer";
import { ClothRenderer } from "./renderer";
import { ClothSimulation } from "./simulation";
import { createGpuContext, GpuUnavailableError, type GpuContext } from "./webgpu";

export type ClothStats = {
  fps: number;
  simTime: number;
  particles: number;
  constraints: number;
  resolution: number;
  backend: ClothBackend;
};

export type ClothController = {
  params: UiParams;
  backend: ClothBackend;
  reset: () => void;
  destroy: () => void;
  getStats: () => ClothStats;
};

declare global {
  interface Window {
    __clothReady?: boolean;
    __clothBackend?: ClothBackend;
  }
}

export async function mountCloth(
  canvas: HTMLCanvasElement,
  initial: UiParams,
): Promise<ClothController> {
  const mesh = buildCloth();
  try {
    const gpu: GpuContext = await createGpuContext(canvas);
    return mountGpu(canvas, gpu, mesh, initial);
  } catch (err) {
    if (err instanceof GpuUnavailableError) {
      console.info("[cloth] WebGPU unavailable, CPU + WebGL2 fallback:", err.message);
      return mountCpu(canvas, mesh, initial);
    }
    throw err;
  }
}

function mountGpu(
  canvas: HTMLCanvasElement,
  gpu: GpuContext,
  mesh: ReturnType<typeof buildCloth>,
  initial: UiParams,
): ClothController {
  const simulation = new ClothSimulation(gpu.device, mesh);
  const renderer = new ClothRenderer(gpu, mesh, simulation.particleBuffer);
  const camera = new OrbitCamera();
  camera.attach(canvas);

  return startLoop({
    canvas,
    camera,
    mesh,
    initial,
    backend: "webgpu",
    step: (params) => {
      // Submit per substep so queue.writeBuffer of uniforms is ordered
      // before that step's compute passes (not batched after all writes).
      const encoder = gpu.device.createCommandEncoder({ label: "sim" });
      simulation.step(encoder, params);
      gpu.device.queue.submit([encoder.finish()]);
    },
    draw: () => {
      const encoder = gpu.device.createCommandEncoder({ label: "draw" });
      renderer.draw(encoder, camera);
      gpu.device.queue.submit([encoder.finish()]);
    },
    resizeRenderer: (w, h) => renderer.resize(w, h),
    simTime: () => simulation.simTime,
    resetSim: () => simulation.reset(),
    destroyResources: () => {
      renderer.destroy();
      simulation.destroy();
      gpu.device.destroy();
    },
  });
}

function mountCpu(
  canvas: HTMLCanvasElement,
  mesh: ReturnType<typeof buildCloth>,
  initial: UiParams,
): ClothController {
  const simulation = new CpuSimulation(mesh);
  const renderer = new GlRenderer(canvas, mesh);
  const camera = new OrbitCamera();
  camera.attach(canvas);

  return startLoop({
    canvas,
    camera,
    mesh,
    initial,
    backend: "webgl",
    step: (params) => {
      simulation.step(params);
    },
    draw: () => {
      renderer.draw(camera, simulation.packedPositions, simulation.markerCenters);
    },
    resizeRenderer: (w, h) => renderer.resize(w, h),
    simTime: () => simulation.simTime,
    resetSim: () => simulation.reset(),
    destroyResources: () => {
      renderer.destroy();
      simulation.destroy();
    },
  });
}

function startLoop(opts: {
  canvas: HTMLCanvasElement;
  camera: OrbitCamera;
  mesh: ReturnType<typeof buildCloth>;
  initial: UiParams;
  backend: ClothBackend;
  step: (params: UiParams) => void;
  draw: () => void;
  resizeRenderer: (w: number, h: number) => void;
  simTime: () => number;
  resetSim: () => void;
  destroyResources: () => void;
}): ClothController {
  const params: UiParams = { ...opts.initial };
  let destroyed = false;
  let raf = 0;
  let acc = 0;
  let last = performance.now();
  let fps = 0;
  let fpsAccum = 0;
  let fpsFrames = 0;

  const resize = () => {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.max(1, Math.floor(opts.canvas.clientWidth * dpr));
    const h = Math.max(1, Math.floor(opts.canvas.clientHeight * dpr));
    if (opts.canvas.width !== w || opts.canvas.height !== h) {
      opts.canvas.width = w;
      opts.canvas.height = h;
    }
    opts.resizeRenderer(w, h);
  };

  const ro = new ResizeObserver(resize);
  ro.observe(opts.canvas);
  resize();

  const frame = (now: number) => {
    if (destroyed) return;
    raf = requestAnimationFrame(frame);
    const rawDt = Math.min(0.1, Math.max(0, (now - last) / 1000));
    last = now;
    fpsAccum += rawDt;
    fpsFrames += 1;
    if (fpsAccum >= 0.4) {
      fps = fpsFrames / fpsAccum;
      fpsAccum = 0;
      fpsFrames = 0;
    }

    resize();
    const aspect = opts.canvas.width / Math.max(1, opts.canvas.height);
    opts.camera.updateViewProj(aspect);

    if (!params.paused) {
      acc += rawDt;
      const maxCatchup = CONFIG.dt * CONFIG.maxSubsteps;
      if (acc > maxCatchup) acc = maxCatchup;
      while (acc >= CONFIG.dt) {
        opts.step(params);
        acc -= CONFIG.dt;
      }
    }
    opts.draw();
  };
  raf = requestAnimationFrame(frame);

  window.__clothReady = true;
  window.__clothBackend = opts.backend;

  return {
    params,
    backend: opts.backend,
    reset: () => {
      acc = 0;
      opts.resetSim();
    },
    destroy: () => {
      destroyed = true;
      cancelAnimationFrame(raf);
      ro.disconnect();
      opts.camera.detach();
      opts.destroyResources();
      window.__clothReady = false;
    },
    getStats: () => ({
      fps,
      simTime: opts.simTime(),
      particles: opts.mesh.particleCount,
      constraints: opts.mesh.constraintCount,
      resolution: opts.mesh.resolution,
      backend: opts.backend,
    }),
  };
}
