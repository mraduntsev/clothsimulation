import { CONFIG } from "./config";
import { buildIcosahedron, type ClothMesh } from "./cloth";
import type { OrbitCamera } from "./camera";

const CLOTH_VERT = `#version 300 es
precision highp float;
layout(location = 0) in vec3 a_position;
uniform mat4 u_viewProj;
out vec3 v_world;
void main() {
  v_world = a_position;
  gl_Position = u_viewProj * vec4(a_position, 1.0);
}`;

const CLOTH_FRAG = `#version 300 es
precision highp float;
in vec3 v_world;
uniform vec3 u_eye;
uniform vec3 u_light;
out vec4 fragColor;
void main() {
  vec3 n = normalize(cross(dFdx(v_world), dFdy(v_world)));
  float ndotl = abs(dot(n, normalize(u_light)));
  float wrap = ndotl * 0.72 + 0.28;
  vec3 view = normalize(u_eye - v_world);
  float rim = pow(1.0 - abs(dot(n, view)), 2.4) * 0.18;
  vec3 rgb = vec3(0.62, 0.62, 0.65) * wrap + vec3(rim);
  fragColor = vec4(rgb, 0.92);
}`;

const WIRE_VERT = `#version 300 es
precision highp float;
layout(location = 0) in vec3 a_position;
uniform mat4 u_viewProj;
void main() {
  vec4 clip = u_viewProj * vec4(a_position, 1.0);
  clip.z -= 0.0008 * clip.w;
  gl_Position = clip;
}`;

const WIRE_FRAG = `#version 300 es
precision highp float;
out vec4 fragColor;
void main() {
  fragColor = vec4(0.07, 0.07, 0.08, 1.0);
}`;

const MARKER_VERT = `#version 300 es
precision highp float;
layout(location = 0) in vec3 a_local;
uniform mat4 u_viewProj;
uniform vec3 u_centers[5];
uniform float u_scale;
out vec3 v_color;
out vec3 v_local;
void main() {
  vec3 color = gl_InstanceID == 4 ? vec3(0.30, 0.55, 1.0) : vec3(0.89, 0.29, 0.29);
  vec3 world = u_centers[gl_InstanceID] + a_local * u_scale;
  v_color = color;
  v_local = a_local;
  gl_Position = u_viewProj * vec4(world, 1.0);
}`;

const MARKER_FRAG = `#version 300 es
precision highp float;
in vec3 v_color;
in vec3 v_local;
uniform vec3 u_light;
out vec4 fragColor;
void main() {
  vec3 n = normalize(v_local);
  float wrap = max(dot(n, normalize(u_light)), 0.0) * 0.55 + 0.45;
  fragColor = vec4(v_color * wrap, 1.0);
}`;

/**
 * WebGL2 fallback renderer. No engine — just a program, VAOs and the packed
 * particle positions produced by {@link CpuSimulation}. Visual contract matches
 * the WebGPU path (flat Lambert cloth, wire overlay, red/blue markers).
 */
export class GlRenderer {
  private readonly gl: WebGL2RenderingContext;
  private readonly mesh: ClothMesh;
  private readonly clothProg: WebGLProgram;
  private readonly wireProg: WebGLProgram;
  private readonly markerProg: WebGLProgram;
  private readonly posBuffer: WebGLBuffer;
  private readonly triBuffer: WebGLBuffer;
  private readonly lineBuffer: WebGLBuffer;
  private readonly markerVbo: WebGLBuffer;
  private readonly markerIbo: WebGLBuffer;
  private readonly clothVao: WebGLVertexArrayObject;
  private readonly wireVao: WebGLVertexArrayObject;
  private readonly markerVao: WebGLVertexArrayObject;
  private readonly markerIndexCount: number;
  private readonly clothLoc: Record<string, WebGLUniformLocation>;
  private readonly wireLoc: Record<string, WebGLUniformLocation>;
  private readonly markerLoc: Record<string, WebGLUniformLocation>;

  constructor(canvas: HTMLCanvasElement, mesh: ClothMesh) {
    const gl = canvas.getContext("webgl2", {
      alpha: false,
      antialias: true,
      depth: true,
      preserveDrawingBuffer: true,
      powerPreference: "high-performance",
    });
    if (!gl) {
      throw new Error("WebGL2 недоступен — нечем нарисовать ткань.");
    }
    this.gl = gl;
    this.mesh = mesh;

    this.clothProg = compile(gl, CLOTH_VERT, CLOTH_FRAG);
    this.wireProg = compile(gl, WIRE_VERT, WIRE_FRAG);
    this.markerProg = compile(gl, MARKER_VERT, MARKER_FRAG);

    this.posBuffer = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.posBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, mesh.particleCount * 12, gl.DYNAMIC_DRAW);

    this.triBuffer = gl.createBuffer()!;
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.triBuffer);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, mesh.triangleIndices, gl.STATIC_DRAW);

    this.lineBuffer = gl.createBuffer()!;
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.lineBuffer);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, mesh.lineIndices, gl.STATIC_DRAW);

    const ico = buildIcosahedron();
    this.markerVbo = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.markerVbo);
    gl.bufferData(gl.ARRAY_BUFFER, ico.positions, gl.STATIC_DRAW);
    this.markerIbo = gl.createBuffer()!;
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.markerIbo);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, ico.indices, gl.STATIC_DRAW);
    this.markerIndexCount = ico.indices.length;

    this.clothVao = makePosVao(gl, this.posBuffer, this.triBuffer);
    this.wireVao = makePosVao(gl, this.posBuffer, this.lineBuffer);

    this.markerVao = gl.createVertexArray()!;
    gl.bindVertexArray(this.markerVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.markerVbo);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.markerIbo);
    gl.bindVertexArray(null);

    this.clothLoc = uniforms(gl, this.clothProg, ["u_viewProj", "u_eye", "u_light"]);
    this.wireLoc = uniforms(gl, this.wireProg, ["u_viewProj"]);
    this.markerLoc = uniforms(gl, this.markerProg, ["u_viewProj", "u_scale", "u_light"]);

    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.disable(gl.CULL_FACE);
  }

  resize(width: number, height: number) {
    this.gl.viewport(0, 0, width, height);
  }

  draw(
    camera: OrbitCamera,
    packedPositions: Float32Array,
    markerCenters: Float32Array,
  ) {
    const gl = this.gl;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.posBuffer);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, packedPositions);

    gl.clearColor(0.173, 0.173, 0.18, 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

    const vp = camera.viewProjGL;
    const light: [number, number, number] = [0.35, -0.55, 0.76];

    gl.useProgram(this.clothProg);
    gl.uniformMatrix4fv(this.clothLoc.u_viewProj, false, vp);
    gl.uniform3f(this.clothLoc.u_eye, camera.eye[0], camera.eye[1], camera.eye[2]);
    gl.uniform3f(this.clothLoc.u_light, light[0], light[1], light[2]);
    gl.bindVertexArray(this.clothVao);
    gl.drawElements(gl.TRIANGLES, this.mesh.triangleIndices.length, gl.UNSIGNED_INT, 0);

    gl.useProgram(this.wireProg);
    gl.uniformMatrix4fv(this.wireLoc.u_viewProj, false, vp);
    gl.bindVertexArray(this.wireVao);
    gl.drawElements(gl.LINES, this.mesh.lineIndices.length, gl.UNSIGNED_INT, 0);

    gl.useProgram(this.markerProg);
    gl.uniformMatrix4fv(this.markerLoc.u_viewProj, false, vp);
    gl.uniform1f(this.markerLoc.u_scale, CONFIG.markerRadius);
    gl.uniform3f(this.markerLoc.u_light, light[0], light[1], light[2]);
    const loc = gl.getUniformLocation(this.markerProg, "u_centers");
    gl.uniform3fv(loc, markerCenters);
    gl.bindVertexArray(this.markerVao);
    gl.drawElementsInstanced(gl.TRIANGLES, this.markerIndexCount, gl.UNSIGNED_SHORT, 0, 5);

    gl.bindVertexArray(null);
  }

  destroy() {
    const gl = this.gl;
    gl.deleteProgram(this.clothProg);
    gl.deleteProgram(this.wireProg);
    gl.deleteProgram(this.markerProg);
    gl.deleteBuffer(this.posBuffer);
    gl.deleteBuffer(this.triBuffer);
    gl.deleteBuffer(this.lineBuffer);
    gl.deleteBuffer(this.markerVbo);
    gl.deleteBuffer(this.markerIbo);
    gl.deleteVertexArray(this.clothVao);
    gl.deleteVertexArray(this.wireVao);
    gl.deleteVertexArray(this.markerVao);
  }
}

function compile(gl: WebGL2RenderingContext, vsSrc: string, fsSrc: string): WebGLProgram {
  const vs = shader(gl, gl.VERTEX_SHADER, vsSrc);
  const fs = shader(gl, gl.FRAGMENT_SHADER, fsSrc);
  const prog = gl.createProgram();
  if (!prog) throw new Error("WebGL program");
  gl.attachShader(prog, vs);
  gl.attachShader(prog, fs);
  gl.linkProgram(prog);
  gl.deleteShader(vs);
  gl.deleteShader(fs);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
    const log = gl.getProgramInfoLog(prog);
    gl.deleteProgram(prog);
    throw new Error(`WebGL link: ${log}`);
  }
  return prog;
}

function shader(gl: WebGL2RenderingContext, type: number, src: string): WebGLShader {
  const sh = gl.createShader(type);
  if (!sh) throw new Error("WebGL shader");
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(sh);
    gl.deleteShader(sh);
    throw new Error(`WebGL compile: ${log}`);
  }
  return sh;
}

function makePosVao(
  gl: WebGL2RenderingContext,
  pos: WebGLBuffer,
  idx: WebGLBuffer,
): WebGLVertexArrayObject {
  const vao = gl.createVertexArray()!;
  gl.bindVertexArray(vao);
  gl.bindBuffer(gl.ARRAY_BUFFER, pos);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, idx);
  gl.bindVertexArray(null);
  return vao;
}

function uniforms(
  gl: WebGL2RenderingContext,
  prog: WebGLProgram,
  names: string[],
): Record<string, WebGLUniformLocation> {
  const out: Record<string, WebGLUniformLocation> = {};
  for (const name of names) {
    const loc = gl.getUniformLocation(prog, name);
    if (loc) out[name] = loc;
  }
  return out;
}
