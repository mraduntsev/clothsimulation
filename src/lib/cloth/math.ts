/** Minimal vec3 / mat4 helpers. Column-major, WebGPU clip space (z in [0, 1]). */

export type Vec3 = [number, number, number];

export function vec3(x: number, y: number, z: number): Vec3 {
  return [x, y, z];
}

export function add(a: Vec3, b: Vec3): Vec3 {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}

export function sub(a: Vec3, b: Vec3): Vec3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

export function scale(a: Vec3, s: number): Vec3 {
  return [a[0] * s, a[1] * s, a[2] * s];
}

export function dot(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

export function cross(a: Vec3, b: Vec3): Vec3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

export function length3(a: Vec3): number {
  return Math.hypot(a[0], a[1], a[2]);
}

export function normalize(a: Vec3): Vec3 {
  const l = length3(a);
  if (l < 1e-12) return [0, 0, 0];
  return [a[0] / l, a[1] / l, a[2] / l];
}

export function identity4(out: Float32Array = new Float32Array(16)): Float32Array {
  out.fill(0);
  out[0] = out[5] = out[10] = out[15] = 1;
  return out;
}

/** Perspective projection matching WebGPU's [0, 1] depth range. */
export function perspective(
  fovY: number,
  aspect: number,
  near: number,
  far: number,
  out: Float32Array = new Float32Array(16),
): Float32Array {
  const f = 1 / Math.tan(fovY / 2);
  const nf = 1 / (near - far);
  out.fill(0);
  out[0] = f / Math.max(aspect, 1e-6);
  out[5] = f;
  out[10] = far * nf;
  out[11] = -1;
  out[14] = far * near * nf;
  return out;
}

/**
 * OpenGL / WebGL clip space, z in [−1, 1]. Used only by the WebGL2 fallback
 * renderer — the WebGPU path keeps {@link perspective}.
 */
export function perspectiveGL(
  fovY: number,
  aspect: number,
  near: number,
  far: number,
  out: Float32Array = new Float32Array(16),
): Float32Array {
  const f = 1 / Math.tan(fovY / 2);
  const nf = 1 / (near - far);
  out.fill(0);
  out[0] = f / Math.max(aspect, 1e-6);
  out[5] = f;
  out[10] = (far + near) * nf;
  out[11] = -1;
  out[14] = 2 * far * near * nf;
  return out;
}

/**
 * Right-handed lookAt. Camera looks along −Z in view space.
 * `up` should be the world up (here: +Z).
 */
export function lookAt(
  eye: Vec3,
  target: Vec3,
  up: Vec3,
  out: Float32Array = new Float32Array(16),
): Float32Array {
  const z = normalize(sub(eye, target));
  let x = cross(up, z);
  if (length3(x) < 1e-8) {
    x = cross([0, 1, 0], z);
  }
  x = normalize(x);
  const y = cross(z, x);

  out[0] = x[0];
  out[1] = y[0];
  out[2] = z[0];
  out[3] = 0;
  out[4] = x[1];
  out[5] = y[1];
  out[6] = z[1];
  out[7] = 0;
  out[8] = x[2];
  out[9] = y[2];
  out[10] = z[2];
  out[11] = 0;
  out[12] = -dot(x, eye);
  out[13] = -dot(y, eye);
  out[14] = -dot(z, eye);
  out[15] = 1;
  return out;
}

export function multiply4(
  a: Float32Array,
  b: Float32Array,
  out: Float32Array = new Float32Array(16),
): Float32Array {
  const r = out === a || out === b ? new Float32Array(16) : out;
  for (let col = 0; col < 4; col++) {
    const b0 = b[col * 4 + 0];
    const b1 = b[col * 4 + 1];
    const b2 = b[col * 4 + 2];
    const b3 = b[col * 4 + 3];
    r[col * 4 + 0] = a[0] * b0 + a[4] * b1 + a[8] * b2 + a[12] * b3;
    r[col * 4 + 1] = a[1] * b0 + a[5] * b1 + a[9] * b2 + a[13] * b3;
    r[col * 4 + 2] = a[2] * b0 + a[6] * b1 + a[10] * b2 + a[14] * b3;
    r[col * 4 + 3] = a[3] * b0 + a[7] * b1 + a[11] * b2 + a[15] * b3;
  }
  if (r !== out) out.set(r);
  return out;
}
