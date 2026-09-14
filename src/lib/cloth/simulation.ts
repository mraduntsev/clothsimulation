import { CONFIG, type UiParams } from "./config";
import type { ClothMesh } from "./cloth";
import { dispatchGroups } from "./webgpu";
import simWgsl from "./shaders/simulation.wgsl?raw";

const SIM_UNIFORM_BYTES = 64;

/**
 * Owns GPU particle / constraint / delta buffers and encodes one PBD step.
 *
 * Simulation step (matches the required kinematic order):
 *   1. write uniforms, including z_center = A sin(2π f t)
 *   2. cs_kinematic     — pin corners, prescribe the center
 *   3. cs_predict       — semi-implicit Euler, dynamic particles only
 *   4. repeat SOLVER_ITERATIONS:
 *        cs_clear → cs_solve → cs_apply     (Jacobi, atomic i32)
 *   5. cs_kinematic     — re-assert Dirichlet conditions after projection
 *   6. cs_velocity      — v = (x − x_prev)/dt, light damping
 *
 * Particle buffer stays on the GPU and is bound read-only by the render
 * pipeline — no GPU→CPU→GPU round trip.
 */
export class ClothSimulation {
  readonly particleBuffer: GPUBuffer;
  readonly mesh: ClothMesh;

  private readonly device: GPUDevice;
  private readonly constraintBuffer: GPUBuffer;
  private readonly deltaBuffer: GPUBuffer;
  private readonly uniformBuffer: GPUBuffer;
  private readonly bindGroup: GPUBindGroup;
  private readonly pipelines: Record<
    "predict" | "clear" | "solve" | "apply" | "kinematic" | "velocity",
    GPUComputePipeline
  >;
  private readonly restParticleData: ArrayBuffer;
  private readonly uniformData = new ArrayBuffer(SIM_UNIFORM_BYTES);
  private readonly uniformF = new Float32Array(this.uniformData);
  private readonly uniformU = new Uint32Array(this.uniformData);

  simTime = 0;

  constructor(device: GPUDevice, mesh: ClothMesh) {
    this.device = device;
    this.mesh = mesh;
    this.restParticleData = mesh.particleData.slice(0);

    this.particleBuffer = device.createBuffer({
      label: "particles",
      size: mesh.particleData.byteLength,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    device.queue.writeBuffer(this.particleBuffer, 0, mesh.particleData);

    this.constraintBuffer = device.createBuffer({
      label: "constraints",
      size: mesh.constraintData.byteLength,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    device.queue.writeBuffer(this.constraintBuffer, 0, mesh.constraintData);

    // 16 bytes per particle: atomic i32 x3 + count.
    this.deltaBuffer = device.createBuffer({
      label: "jacobi-deltas",
      size: mesh.particleCount * 16,
      usage: GPUBufferUsage.STORAGE,
    });

    this.uniformBuffer = device.createBuffer({
      label: "sim-params",
      size: SIM_UNIFORM_BYTES,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    const module = device.createShaderModule({ label: "pbd-sim", code: simWgsl });
    const layout = this.createBindGroupLayout();
    const pipelineLayout = device.createPipelineLayout({ bindGroupLayouts: [layout] });
    const make = (entry: string) =>
      device.createComputePipeline({
        label: entry,
        layout: pipelineLayout,
        compute: { module, entryPoint: entry },
      });

    this.pipelines = {
      predict: make("cs_predict"),
      clear: make("cs_clear"),
      solve: make("cs_solve"),
      apply: make("cs_apply"),
      kinematic: make("cs_kinematic"),
      velocity: make("cs_velocity"),
    };

    this.bindGroup = device.createBindGroup({
      layout,
      entries: [
        { binding: 0, resource: { buffer: this.particleBuffer } },
        { binding: 1, resource: { buffer: this.constraintBuffer } },
        { binding: 2, resource: { buffer: this.deltaBuffer } },
        { binding: 3, resource: { buffer: this.uniformBuffer } },
      ],
    });
  }

  private createBindGroupLayout(): GPUBindGroupLayout {
    return this.device.createBindGroupLayout({
      entries: [
        {
          binding: 0,
          visibility: GPUShaderStage.COMPUTE,
          buffer: { type: "storage" },
        },
        {
          binding: 1,
          visibility: GPUShaderStage.COMPUTE,
          buffer: { type: "read-only-storage" },
        },
        {
          binding: 2,
          visibility: GPUShaderStage.COMPUTE,
          buffer: { type: "storage" },
        },
        {
          binding: 3,
          visibility: GPUShaderStage.COMPUTE,
          buffer: { type: "uniform" },
        },
      ],
    });
  }

  reset() {
    this.simTime = 0;
    this.device.queue.writeBuffer(this.particleBuffer, 0, this.restParticleData);
  }

  step(encoder: GPUCommandEncoder, ui: UiParams) {
    this.writeUniforms(ui);
    const pGroups = dispatchGroups(this.mesh.particleCount);
    const cGroups = dispatchGroups(this.mesh.constraintCount);
    const iterations = Math.max(1, Math.min(32, Math.round(ui.iterations)));

    // 1–2. Prescribe kinematics for this instant, then predict free particles.
    this.dispatch(encoder, this.pipelines.kinematic, pGroups);
    this.dispatch(encoder, this.pipelines.predict, pGroups);

    // 3. Jacobi PBD. Separate compute passes = guaranteed storage visibility.
    for (let i = 0; i < iterations; i++) {
      this.dispatch(encoder, this.pipelines.clear, pGroups);
      this.dispatch(encoder, this.pipelines.solve, cGroups);
      this.dispatch(encoder, this.pipelines.apply, pGroups);
    }

    // 4–5. Re-pin Dirichlet vertices so the projector cannot pull them, then
    //      write velocities from the accepted positions.
    this.dispatch(encoder, this.pipelines.kinematic, pGroups);
    this.dispatch(encoder, this.pipelines.velocity, pGroups);

    this.simTime += CONFIG.dt;
  }

  private dispatch(encoder: GPUCommandEncoder, pipeline: GPUComputePipeline, groups: number) {
    const pass = encoder.beginComputePass();
    pass.setPipeline(pipeline);
    pass.setBindGroup(0, this.bindGroup);
    pass.dispatchWorkgroups(groups);
    pass.end();
  }

  private writeUniforms(ui: UiParams) {
    const f = this.uniformF;
    const u = this.uniformU;
    f[0] = CONFIG.dt;
    f[1] = ui.gravity ? -CONFIG.gravity : 0;
    f[2] = this.simTime;
    f[3] = ui.damping;
    f[4] = ui.amplitude;
    f[5] = ui.frequency;
    f[6] = CONFIG.jacobiOmega;
    u[7] = this.mesh.particleCount;
    u[8] = this.mesh.constraintCount;
    u[9] = this.mesh.centerIndex;
    u[10] = this.mesh.resolution;
    u[11] = 0;
    f[12] = this.mesh.centerRest[0];
    f[13] = this.mesh.centerRest[1];
    f[14] = this.mesh.centerRest[2];
    f[15] = 0;
    this.device.queue.writeBuffer(this.uniformBuffer, 0, this.uniformData);
  }

  destroy() {
    this.particleBuffer.destroy();
    this.constraintBuffer.destroy();
    this.deltaBuffer.destroy();
    this.uniformBuffer.destroy();
  }
}
