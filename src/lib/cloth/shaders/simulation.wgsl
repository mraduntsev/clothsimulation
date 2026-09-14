// =============================================================================
// GPU Position Based Dynamics — cloth solver
// =============================================================================
// Parallelisation strategy: Jacobi PBD with fixed-point atomic accumulation.
//
// Why this, not naïve parallel Gauss–Seidel:
//   A distance constraint writes both endpoints. If two threads in the same
//   dispatch share a vertex, unsynchronised float writes race and the solver
//   becomes non-deterministic (and can explode). WebGPU has no native
//   atomicAdd for f32, so we quantise corrections to i32 (scale 1e6) and
//   accumulate with atomicAdd. A second pass averages the summed Δx by the
//   number of contributing constraints (classic Jacobi) and writes each
//   particle exactly once — no races.
//
// Why not constraint colouring:
//   A regular grid is colourable, but bending (skip-1) needs 4 colours per
//   axis, shear another 4, structural 4: ~16 batches, 16 dispatches per
//   iteration. Jacobi is one solve dispatch regardless of constraint type,
//   so adding dihedral bending later is a data change, not a recolour.
//
// XPBD hook: Constraint.stiffness is the PBD k ∈ [0,1]. Replacing the
//   correction `s = k * C / wSum` with XPBD's
//     Δλ = (−C − α̃ λ) / (wSum + α̃),  α̃ = compliance / dt²
//   only requires a λ buffer and a compliance field. compliance = 0 is PBD.
// =============================================================================

struct Particle {
  position: vec3f,
  invMass: f32,
  prevPosition: vec3f,
  flags: u32,
  velocity: vec3f,
  pad: f32,
};

struct Constraint {
  indexA: u32,
  indexB: u32,
  restLength: f32,
  stiffness: f32,
};

struct AtomicDelta {
  x: atomic<i32>,
  y: atomic<i32>,
  z: atomic<i32>,
  count: atomic<i32>,
};

struct SimParams {
  dt: f32,
  gravityZ: f32,
  time: f32,
  damping: f32,
  amplitude: f32,
  frequency: f32,
  jacobiOmega: f32,
  particleCount: u32,
  constraintCount: u32,
  centerIndex: u32,
  gridN: u32,
  pad0: u32,
  centerRest: vec4f,
};

const FLAG_FIXED: u32 = 1u;
const FLAG_KINEMATIC: u32 = 2u;
const DELTA_SCALE: f32 = 1000000.0;
const PI2: f32 = 6.283185307179586;

@group(0) @binding(0) var<storage, read_write> particles: array<Particle>;
@group(0) @binding(1) var<storage, read> constraints: array<Constraint>;
@group(0) @binding(2) var<storage, read_write> deltas: array<AtomicDelta>;
@group(0) @binding(3) var<uniform> params: SimParams;

// ---------------------------------------------------------------------------
// 1. Apply external acceleration and predict positions.
//    Infinite-mass particles (corners + kinematic center) are skipped:
//    they never receive gravity, force, impulse or velocity integration.
// ---------------------------------------------------------------------------
@compute @workgroup_size(64)
fn cs_predict(@builtin(global_invocation_id) gid: vec3u) {
  let i = gid.x;
  if (i >= params.particleCount) { return; }
  var p = particles[i];
  if (p.invMass <= 0.0) { return; }
  p.velocity += vec3f(0.0, 0.0, params.gravityZ) * params.dt;
  p.prevPosition = p.position;
  p.position += p.velocity * params.dt;
  particles[i] = p;
}

// ---------------------------------------------------------------------------
// 2. Zero the Jacobi accumulation buffer.
// ---------------------------------------------------------------------------
@compute @workgroup_size(64)
fn cs_clear(@builtin(global_invocation_id) gid: vec3u) {
  let i = gid.x;
  if (i >= params.particleCount) { return; }
  atomicStore(&deltas[i].x, 0);
  atomicStore(&deltas[i].y, 0);
  atomicStore(&deltas[i].z, 0);
  atomicStore(&deltas[i].count, 0);
}

fn accumulate(index: u32, corr: vec3f, invMass: f32) {
  if (invMass <= 0.0) { return; }
  atomicAdd(&deltas[index].x, i32(round(corr.x * DELTA_SCALE)));
  atomicAdd(&deltas[index].y, i32(round(corr.y * DELTA_SCALE)));
  atomicAdd(&deltas[index].z, i32(round(corr.z * DELTA_SCALE)));
  atomicAdd(&deltas[index].count, 1);
}

// ---------------------------------------------------------------------------
// 3. Distance constraint projector (Müller et al. 2007).
//    C(p_i, p_j) = |p_i − p_j| − d0
//    Δp_i = −w_i / (w_i+w_j) * k * C * n
//    Corrections are accumulated, not applied — Jacobi, race-free.
// ---------------------------------------------------------------------------
@compute @workgroup_size(64)
fn cs_solve(@builtin(global_invocation_id) gid: vec3u) {
  let i = gid.x;
  if (i >= params.constraintCount) { return; }
  let c = constraints[i];
  let a = particles[c.indexA];
  let b = particles[c.indexB];
  let wSum = a.invMass + b.invMass;
  if (wSum <= 1e-8) { return; }
  let delta = a.position - b.position;
  let len = length(delta);
  if (len < 1e-8) { return; }
  let n = delta / len;
  let C = len - c.restLength;
  let s = c.stiffness * C / wSum;
  accumulate(c.indexA, -s * a.invMass * n, a.invMass);
  accumulate(c.indexB,  s * b.invMass * n, b.invMass);
}

// ---------------------------------------------------------------------------
// 4. Average accumulated corrections and write each particle once.
// ---------------------------------------------------------------------------
@compute @workgroup_size(64)
fn cs_apply(@builtin(global_invocation_id) gid: vec3u) {
  let i = gid.x;
  if (i >= params.particleCount) { return; }
  var p = particles[i];
  if (p.invMass <= 0.0) { return; }
  let cnt = atomicLoad(&deltas[i].count);
  if (cnt <= 0) { return; }
  let invScale = 1.0 / DELTA_SCALE;
  let dx = f32(atomicLoad(&deltas[i].x)) * invScale;
  let dy = f32(atomicLoad(&deltas[i].y)) * invScale;
  let dz = f32(atomicLoad(&deltas[i].z)) * invScale;
  p.position += vec3f(dx, dy, dz) * (params.jacobiOmega / f32(cnt));
  particles[i] = p;
}

// ---------------------------------------------------------------------------
// 5. Kinematic / Dirichlet boundary conditions.
//    Center: p = (x0, y0, A sin(2π f t))  — prescribed position, not a force.
//    Corners: snap back to rest (invMass = 0 already keeps them still; this
//    is a hard restore so a numerical glitch cannot drift them).
// ---------------------------------------------------------------------------
@compute @workgroup_size(64)
fn cs_kinematic(@builtin(global_invocation_id) gid: vec3u) {
  let i = gid.x;
  if (i >= params.particleCount) { return; }
  var p = particles[i];
  if ((p.flags & FLAG_KINEMATIC) != 0u) {
    let z = params.amplitude * sin(PI2 * params.frequency * params.time);
    p.position = vec3f(params.centerRest.x, params.centerRest.y, z);
    particles[i] = p;
    return;
  }
  if ((p.flags & FLAG_FIXED) != 0u) {
    p.position = p.prevPosition;
    p.velocity = vec3f(0.0);
    particles[i] = p;
  }
}

// ---------------------------------------------------------------------------
// 6. Velocity update from the positional displacement, then light damping.
//    Damping is not applied to infinite-mass particles.
// ---------------------------------------------------------------------------
@compute @workgroup_size(64)
fn cs_velocity(@builtin(global_invocation_id) gid: vec3u) {
  let i = gid.x;
  if (i >= params.particleCount) { return; }
  var p = particles[i];
  let dt = max(params.dt, 1e-8);
  let vel = (p.position - p.prevPosition) / dt;
  if (p.invMass > 0.0) {
    p.velocity = vel * params.damping;
  } else {
    p.velocity = vel;
  }
  p.prevPosition = p.position;
  particles[i] = p;
}
