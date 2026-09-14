/**
 * Tunable simulation constants.
 *
 * The cloth lives in the XY plane (Z = 0 at rest). Gravity, when enabled,
 * points along −Z. The central kinematic vertex is driven by
 *   z(t) = amplitude * sin(2π * frequency * t)
 * and is never integrated as a dynamic particle.
 */
export const CONFIG = {
  /** Edge length of the square sheet, world units. */
  clothSize: 10,

  /**
   * Vertices per side. Odd so a true center vertex exists.
   * 51 × 51 = 2601 particles, close to the 50 × 50 target.
   */
  resolution: 51,

  /** PBD constraint-projection iterations per physics substep. */
  solverIterations: 14,

  /**
   * Jacobi over-relaxation. 1.0 = pure averaged Jacobi (most stable).
   * A little SOR speeds wave travel across the 25-hop radius without
   * destabilising a 51×51 sheet.
   */
  jacobiOmega: 1.25,

  /** Kinematic drive. */
  amplitude: 1.0,
  frequency: 1.0,

  /**
   * Velocity damping applied after v = (x − x_prev) / dt.
   * Keep close to 1 so transverse waves remain visible.
   */
  damping: 0.994,

  gravity: 9.81,

  /** Distance-constraint stiffness in [0, 1] (PBD k, applied per iteration). */
  structuralStiffness: 1.0,
  shearStiffness: 0.85,
  bendingStiffness: 0.22,

  /** Fixed physics tick. Render is decoupled via an accumulator. */
  dt: 1 / 60,
  maxSubsteps: 3,

  /** Icosahedron marker radius in world units. */
  markerRadius: 0.16,

  camera: {
    yaw: Math.PI / 4,
    pitch: 0.52,
    distance: 16.5,
    minDistance: 6,
    maxDistance: 36,
    minPitch: 0.12,
    maxPitch: 1.42,
    fovY: (42 * Math.PI) / 180,
    near: 0.1,
    far: 200,
  },
} as const;

export const PARTICLE_FLOATS = 12;
export const PARTICLE_STRIDE_BYTES = PARTICLE_FLOATS * 4;
export const CONSTRAINT_FLOATS = 4;
export const CONSTRAINT_STRIDE_BYTES = CONSTRAINT_FLOATS * 4;

export const FLAG_FIXED = 1;
export const FLAG_KINEMATIC = 2;

export type ClothBackend = "webgpu" | "webgl";

export type UiParams = {
  gravity: boolean;
  paused: boolean;
  amplitude: number;
  frequency: number;
  iterations: number;
  damping: number;
};
