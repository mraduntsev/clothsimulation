import {
  CONFIG,
  CONSTRAINT_FLOATS,
  FLAG_FIXED,
  FLAG_KINEMATIC,
  PARTICLE_FLOATS,
  type UiParams,
} from "./config";
import type { ClothMesh } from "./cloth";

/**
 * CPU Jacobi PBD — same algorithm as the WGSL compute path, used when WebGPU
 * is unavailable. Still race-free (serial Jacobi: read a snapshot, average
 * corrections, write each particle once). Not a spring-mass / force integrator.
 */
export class CpuSimulation {
  readonly mesh: ClothMesh;
  readonly packedPositions: Float32Array;
  readonly markerCenters = new Float32Array(15);

  simTime = 0;

  private readonly particles: ArrayBuffer;
  private readonly rest: ArrayBuffer;
  private readonly pf: Float32Array;
  private readonly pu: Uint32Array;
  private readonly restF: Float32Array;
  private readonly constraintsU: Uint32Array;
  private readonly constraintsF: Float32Array;
  private readonly dx: Float32Array;
  private readonly dy: Float32Array;
  private readonly dz: Float32Array;
  private readonly count: Int32Array;

  constructor(mesh: ClothMesh) {
    this.mesh = mesh;
    this.particles = mesh.particleData.slice(0);
    this.rest = mesh.particleData.slice(0);
    this.pf = new Float32Array(this.particles);
    this.pu = new Uint32Array(this.particles);
    this.restF = new Float32Array(this.rest);
    this.constraintsU = new Uint32Array(mesh.constraintData);
    this.constraintsF = new Float32Array(mesh.constraintData);
    const n = mesh.particleCount;
    this.dx = new Float32Array(n);
    this.dy = new Float32Array(n);
    this.dz = new Float32Array(n);
    this.count = new Int32Array(n);
    this.packedPositions = new Float32Array(n * 3);
    this.pack();
  }

  reset() {
    this.simTime = 0;
    this.pf.set(this.restF);
    this.pack();
  }

  step(ui: UiParams) {
    this.applyKinematic(ui);
    this.predict(ui);
    const iterations = Math.max(1, Math.min(32, Math.round(ui.iterations)));
    for (let i = 0; i < iterations; i++) {
      this.solveJacobi();
    }
    this.applyKinematic(ui);
    this.updateVelocity(ui);
    this.simTime += CONFIG.dt;
    this.pack();
  }

  destroy() {
    /* no GPU resources */
  }

  private applyKinematic(ui: UiParams) {
    const { pf, pu } = this;
    const n = this.mesh.particleCount;
    const z = ui.amplitude * Math.sin(2 * Math.PI * ui.frequency * this.simTime);
    const [cx, cy] = this.mesh.centerRest;
    for (let i = 0; i < n; i++) {
      const base = i * PARTICLE_FLOATS;
      const flags = pu[base + 7];
      if (flags & FLAG_KINEMATIC) {
        pf[base + 0] = cx;
        pf[base + 1] = cy;
        pf[base + 2] = z;
      } else if (flags & FLAG_FIXED) {
        pf[base + 0] = pf[base + 4];
        pf[base + 1] = pf[base + 5];
        pf[base + 2] = pf[base + 6];
        pf[base + 8] = 0;
        pf[base + 9] = 0;
        pf[base + 10] = 0;
      }
    }
  }

  private predict(ui: UiParams) {
    const { pf } = this;
    const n = this.mesh.particleCount;
    const dt = CONFIG.dt;
    const gz = ui.gravity ? -CONFIG.gravity : 0;
    for (let i = 0; i < n; i++) {
      const base = i * PARTICLE_FLOATS;
      const invMass = pf[base + 3];
      if (invMass <= 0) continue;
      pf[base + 10] += gz * dt;
      pf[base + 4] = pf[base + 0];
      pf[base + 5] = pf[base + 1];
      pf[base + 6] = pf[base + 2];
      pf[base + 0] += pf[base + 8] * dt;
      pf[base + 1] += pf[base + 9] * dt;
      pf[base + 2] += pf[base + 10] * dt;
    }
  }

  private solveJacobi() {
    const { pf, dx, dy, dz, count, constraintsU, constraintsF } = this;
    const n = this.mesh.particleCount;
    const m = this.mesh.constraintCount;
    dx.fill(0);
    dy.fill(0);
    dz.fill(0);
    count.fill(0);

    for (let k = 0; k < m; k++) {
      const src = k * CONSTRAINT_FLOATS;
      const ia = constraintsU[src + 0];
      const ib = constraintsU[src + 1];
      const rest = constraintsF[src + 2];
      const stiff = constraintsF[src + 3];
      const a = ia * PARTICLE_FLOATS;
      const b = ib * PARTICLE_FLOATS;
      const wA = pf[a + 3];
      const wB = pf[b + 3];
      const wSum = wA + wB;
      if (wSum <= 1e-8) continue;
      const ddx = pf[a] - pf[b];
      const ddy = pf[a + 1] - pf[b + 1];
      const ddz = pf[a + 2] - pf[b + 2];
      const len = Math.hypot(ddx, ddy, ddz);
      if (len < 1e-8) continue;
      const C = len - rest;
      const s = (stiff * C) / wSum;
      const invLen = 1 / len;
      const nx = ddx * invLen;
      const ny = ddy * invLen;
      const nz = ddz * invLen;
      if (wA > 0) {
        dx[ia] += -s * wA * nx;
        dy[ia] += -s * wA * ny;
        dz[ia] += -s * wA * nz;
        count[ia] += 1;
      }
      if (wB > 0) {
        dx[ib] += s * wB * nx;
        dy[ib] += s * wB * ny;
        dz[ib] += s * wB * nz;
        count[ib] += 1;
      }
    }

    const omega = CONFIG.jacobiOmega;
    for (let i = 0; i < n; i++) {
      const c = count[i];
      if (c <= 0) continue;
      const base = i * PARTICLE_FLOATS;
      if (pf[base + 3] <= 0) continue;
      const s = omega / c;
      pf[base + 0] += dx[i] * s;
      pf[base + 1] += dy[i] * s;
      pf[base + 2] += dz[i] * s;
    }
  }

  private updateVelocity(ui: UiParams) {
    const { pf } = this;
    const n = this.mesh.particleCount;
    const invDt = 1 / Math.max(CONFIG.dt, 1e-8);
    const damp = ui.damping;
    for (let i = 0; i < n; i++) {
      const base = i * PARTICLE_FLOATS;
      let vx = (pf[base + 0] - pf[base + 4]) * invDt;
      let vy = (pf[base + 1] - pf[base + 5]) * invDt;
      let vz = (pf[base + 2] - pf[base + 6]) * invDt;
      if (pf[base + 3] > 0) {
        vx *= damp;
        vy *= damp;
        vz *= damp;
      }
      pf[base + 8] = vx;
      pf[base + 9] = vy;
      pf[base + 10] = vz;
      pf[base + 4] = pf[base + 0];
      pf[base + 5] = pf[base + 1];
      pf[base + 6] = pf[base + 2];
    }
  }

  private pack() {
    const { pf, packedPositions, markerCenters, mesh } = this;
    const n = mesh.particleCount;
    for (let i = 0; i < n; i++) {
      const b = i * PARTICLE_FLOATS;
      packedPositions[i * 3] = pf[b];
      packedPositions[i * 3 + 1] = pf[b + 1];
      packedPositions[i * 3 + 2] = pf[b + 2];
    }
    const corners = mesh.cornerIndices;
    for (let k = 0; k < 4; k++) {
      const b = corners[k] * PARTICLE_FLOATS;
      markerCenters[k * 3] = pf[b];
      markerCenters[k * 3 + 1] = pf[b + 1];
      markerCenters[k * 3 + 2] = pf[b + 2];
    }
    const cb = mesh.centerIndex * PARTICLE_FLOATS;
    markerCenters[12] = pf[cb];
    markerCenters[13] = pf[cb + 1];
    markerCenters[14] = pf[cb + 2];
  }
}
