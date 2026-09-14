struct Particle {
  position: vec3f,
  invMass: f32,
  prevPosition: vec3f,
  flags: u32,
  velocity: vec3f,
  pad: f32,
};

struct RenderUniforms {
  viewProj: mat4x4<f32>,
  eye: vec4f,
  lightDir: vec4f,
  clothColor: vec4f,
  wireColor: vec4f,
  cornerIndices: vec4u,
  centerIndex: u32,
  markerScale: f32,
  pad0: f32,
  pad1: f32,
};

@group(0) @binding(0) var<storage, read> particles: array<Particle>;
@group(0) @binding(1) var<uniform> uni: RenderUniforms;

struct ClothOut {
  @builtin(position) clip: vec4f,
  @location(0) world: vec3f,
};

@vertex
fn vs_cloth(@builtin(vertex_index) vid: u32) -> ClothOut {
  let p = particles[vid].position;
  var o: ClothOut;
  o.clip = uni.viewProj * vec4f(p, 1.0);
  o.world = p;
  return o;
}

@fragment
fn fs_cloth(input: ClothOut) -> @location(0) vec4f {
  let n = normalize(cross(dpdx(input.world), dpdy(input.world)));
  let l = normalize(uni.lightDir.xyz);
  // Two-sided Lambert so folds read from both sides of the sheet.
  let ndotl = abs(dot(n, l));
  let wrap = ndotl * 0.72 + 0.28;
  let view = normalize(uni.eye.xyz - input.world);
  let rim = pow(1.0 - abs(dot(n, view)), 2.4) * 0.18;
  let rgb = uni.clothColor.xyz * wrap + vec3f(rim);
  return vec4f(rgb, uni.clothColor.w);
}

@vertex
fn vs_wire(@builtin(vertex_index) vid: u32) -> @builtin(position) vec4f {
  let p = particles[vid].position;
  return uni.viewProj * vec4f(p, 1.0);
}

@fragment
fn fs_wire() -> @location(0) vec4f {
  return uni.wireColor;
}

struct MarkerOut {
  @builtin(position) clip: vec4f,
  @location(0) color: vec3f,
  @location(1) local: vec3f,
};

@vertex
fn vs_marker(
  @location(0) local: vec3f,
  @builtin(instance_index) inst: u32,
) -> MarkerOut {
  var index: u32;
  var color: vec3f;
  if (inst == 4u) {
    index = uni.centerIndex;
    color = vec3f(0.30, 0.55, 1.0);
  } else {
    index = uni.cornerIndices[inst];
    color = vec3f(0.89, 0.29, 0.29);
  }
  let center = particles[index].position;
  let world = center + local * uni.markerScale;
  var o: MarkerOut;
  o.clip = uni.viewProj * vec4f(world, 1.0);
  o.color = color;
  o.local = local;
  return o;
}

@fragment
fn fs_marker(input: MarkerOut) -> @location(0) vec4f {
  let n = normalize(input.local);
  let l = normalize(uni.lightDir.xyz);
  let wrap = max(dot(n, l), 0.0) * 0.55 + 0.45;
  return vec4f(input.color * wrap, 1.0);
}
