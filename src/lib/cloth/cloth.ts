import {
  CONFIG,
  CONSTRAINT_FLOATS,
  FLAG_FIXED,
  FLAG_KINEMATIC,
  PARTICLE_FLOATS,
} from "./config";

export type ClothMesh = {
  particleCount: number;
  constraintCount: number;
  resolution: number;
  particleData: ArrayBuffer;
  constraintData: ArrayBuffer;
  triangleIndices: Uint32Array;
  lineIndices: Uint32Array;
  cornerIndices: [number, number, number, number];
  centerIndex: number;
  centerRest: [number, number, number];
};

/**
 * Regular square lattice in the XY plane, Z = 0.
 * Each quad is split by one diagonal into two triangles (the reference mesh).
 *
 * Particle layout (48 bytes, matches WGSL `Particle`):
 *   float3 position, float invMass,
 *   float3 prevPosition, uint flags,
 *   float3 velocity, float pad
 *
 * Constraint layout (16 bytes, matches WGSL `Constraint`):
 *   uint a, uint b, float restLength, float stiffness
 */
export function buildCloth(
  resolution = CONFIG.resolution,
  size = CONFIG.clothSize,
): ClothMesh {
  const n = resolution;
  const particleCount = n * n;
  const cell = size / (n - 1);
  const origin = -size / 2;

  const particleData = new ArrayBuffer(particleCount * PARTICLE_FLOATS * 4);
  const pf = new Float32Array(particleData);
  const pu = new Uint32Array(particleData);
  const rest = new Float32Array(particleCount * 3);

  const at = (i: number, j: number) => j * n + i;

  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const id = at(i, j);
      const x = origin + i * cell;
      const y = origin + j * cell;
      const base = id * PARTICLE_FLOATS;
      pf[base + 0] = x;
      pf[base + 1] = y;
      pf[base + 2] = 0;
      pf[base + 3] = 1;
      pf[base + 4] = x;
      pf[base + 5] = y;
      pf[base + 6] = 0;
      pu[base + 7] = 0;
      pf[base + 8] = 0;
      pf[base + 9] = 0;
      pf[base + 10] = 0;
      pf[base + 11] = 0;
      rest[id * 3 + 0] = x;
      rest[id * 3 + 1] = y;
      rest[id * 3 + 2] = 0;
    }
  }

  const cornerIndices: [number, number, number, number] = [
    at(0, 0),
    at(n - 1, 0),
    at(0, n - 1),
    at(n - 1, n - 1),
  ];
  for (const c of cornerIndices) {
    pf[c * PARTICLE_FLOATS + 3] = 0;
    pu[c * PARTICLE_FLOATS + 7] = FLAG_FIXED;
  }

  const ci = Math.floor((n - 1) / 2);
  const centerIndex = at(ci, ci);
  pf[centerIndex * PARTICLE_FLOATS + 3] = 0;
  pu[centerIndex * PARTICLE_FLOATS + 7] = FLAG_KINEMATIC;
  const centerRest: [number, number, number] = [rest[centerIndex * 3], rest[centerIndex * 3 + 1], 0];

  const constraints: number[] = [];
  const pushConstraint = (a: number, b: number, stiffness: number) => {
    const dx = rest[a * 3] - rest[b * 3];
    const dy = rest[a * 3 + 1] - rest[b * 3 + 1];
    const dz = rest[a * 3 + 2] - rest[b * 3 + 2];
    constraints.push(a, b, Math.hypot(dx, dy, dz), stiffness);
  };

  // Structural: axis-aligned 1-ring (stretch resistance).
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n - 1; i++) pushConstraint(at(i, j), at(i + 1, j), CONFIG.structuralStiffness);
  }
  for (let j = 0; j < n - 1; j++) {
    for (let i = 0; i < n; i++) pushConstraint(at(i, j), at(i, j + 1), CONFIG.structuralStiffness);
  }

  // Shear: both diagonals of every quad.
  for (let j = 0; j < n - 1; j++) {
    for (let i = 0; i < n - 1; i++) {
      pushConstraint(at(i, j), at(i + 1, j + 1), CONFIG.shearStiffness);
      pushConstraint(at(i + 1, j), at(i, j + 1), CONFIG.shearStiffness);
    }
  }

  // Bending: skip-one distance constraints. Cheaper than dihedral-angle
  // constraints and maps 1:1 onto the same GPU distance projector; a dihedral
  // term can be added later as another Constraint batch without changing the
  // solver architecture.
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n - 2; i++) pushConstraint(at(i, j), at(i + 2, j), CONFIG.bendingStiffness);
  }
  for (let j = 0; j < n - 2; j++) {
    for (let i = 0; i < n; i++) pushConstraint(at(i, j), at(i, j + 2), CONFIG.bendingStiffness);
  }

  const constraintCount = constraints.length / CONSTRAINT_FLOATS;
  const constraintData = new ArrayBuffer(constraintCount * CONSTRAINT_FLOATS * 4);
  const cf = new Float32Array(constraintData);
  const cu = new Uint32Array(constraintData);
  for (let k = 0; k < constraintCount; k++) {
    const src = k * CONSTRAINT_FLOATS;
    const dst = k * CONSTRAINT_FLOATS;
    cu[dst + 0] = constraints[src + 0] as number;
    cu[dst + 1] = constraints[src + 1] as number;
    cf[dst + 2] = constraints[src + 2] as number;
    cf[dst + 3] = constraints[src + 3] as number;
  }

  // Two triangles per quad, consistent diagonal (i,j) → (i+1, j+1).
  const segs = n - 1;
  const triangleIndices = new Uint32Array(segs * segs * 6);
  let t = 0;
  for (let j = 0; j < segs; j++) {
    for (let i = 0; i < segs; i++) {
      const v00 = at(i, j);
      const v10 = at(i + 1, j);
      const v01 = at(i, j + 1);
      const v11 = at(i + 1, j + 1);
      triangleIndices[t++] = v00;
      triangleIndices[t++] = v10;
      triangleIndices[t++] = v11;
      triangleIndices[t++] = v00;
      triangleIndices[t++] = v11;
      triangleIndices[t++] = v01;
    }
  }

  // Structural edges + the triangulation diagonal, matching the reference mesh.
  const edgeCount = segs * n + segs * n + segs * segs;
  const lineIndices = new Uint32Array(edgeCount * 2);
  let l = 0;
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < segs; i++) {
      lineIndices[l++] = at(i, j);
      lineIndices[l++] = at(i + 1, j);
    }
  }
  for (let j = 0; j < segs; j++) {
    for (let i = 0; i < n; i++) {
      lineIndices[l++] = at(i, j);
      lineIndices[l++] = at(i, j + 1);
    }
  }
  for (let j = 0; j < segs; j++) {
    for (let i = 0; i < segs; i++) {
      lineIndices[l++] = at(i, j);
      lineIndices[l++] = at(i + 1, j + 1);
    }
  }

  return {
    particleCount,
    constraintCount,
    resolution: n,
    particleData,
    constraintData,
    triangleIndices,
    lineIndices,
    cornerIndices,
    centerIndex,
    centerRest,
  };
}

/** Local-space unit icosahedron used as a marker mesh. */
export function buildIcosahedron(): { positions: Float32Array; indices: Uint16Array } {
  const phi = (1 + Math.sqrt(5)) / 2;
  const raw: number[][] = [
    [-1, phi, 0],
    [1, phi, 0],
    [-1, -phi, 0],
    [1, -phi, 0],
    [0, -1, phi],
    [0, 1, phi],
    [0, -1, -phi],
    [0, 1, -phi],
    [phi, 0, -1],
    [phi, 0, 1],
    [-phi, 0, -1],
    [-phi, 0, 1],
  ];
  const positions = new Float32Array(raw.length * 3);
  for (let i = 0; i < raw.length; i++) {
    const [x, y, z] = raw[i];
    const len = Math.hypot(x, y, z);
    positions[i * 3] = x / len;
    positions[i * 3 + 1] = y / len;
    positions[i * 3 + 2] = z / len;
  }
  const indices = new Uint16Array([
    0, 11, 5, 0, 5, 1, 0, 1, 7, 0, 7, 10, 0, 10, 11, 1, 5, 9, 5, 11, 4, 11, 10, 2, 10, 7, 6, 7, 1,
    8, 3, 9, 4, 3, 4, 2, 3, 2, 6, 3, 6, 8, 3, 8, 9, 4, 9, 5, 2, 4, 11, 6, 2, 10, 8, 6, 7, 9, 8, 1,
  ]);
  return { positions, indices };
}
