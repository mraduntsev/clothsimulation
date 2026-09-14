import { CONFIG } from "./config";
import { buildIcosahedron, type ClothMesh } from "./cloth";
import type { OrbitCamera } from "./camera";
import type { GpuContext } from "./webgpu";
import renderWgsl from "./shaders/render.wgsl?raw";

const RENDER_UNIFORM_BYTES = 160;

export class ClothRenderer {
  private readonly gpu: GpuContext;
  private readonly mesh: ClothMesh;
  private readonly particleBuffer: GPUBuffer;
  private readonly uniformBuffer: GPUBuffer;
  private readonly triangleIndexBuffer: GPUBuffer;
  private readonly lineIndexBuffer: GPUBuffer;
  private readonly markerVertexBuffer: GPUBuffer;
  private readonly markerIndexBuffer: GPUBuffer;
  private readonly markerIndexCount: number;
  private readonly clothPipeline: GPURenderPipeline;
  private readonly wirePipeline: GPURenderPipeline;
  private readonly markerPipeline: GPURenderPipeline;
  private readonly bindGroup: GPUBindGroup;
  private readonly uniformData = new ArrayBuffer(RENDER_UNIFORM_BYTES);
  private readonly uniformF = new Float32Array(this.uniformData);
  private readonly uniformU = new Uint32Array(this.uniformData);

  private depthTexture: GPUTexture | null = null;
  private msaaTexture: GPUTexture | null = null;
  private width = 0;
  private height = 0;

  constructor(gpu: GpuContext, mesh: ClothMesh, particleBuffer: GPUBuffer) {
    this.gpu = gpu;
    this.mesh = mesh;
    this.particleBuffer = particleBuffer;
    const { device, format, sampleCount } = gpu;

    this.uniformBuffer = device.createBuffer({
      label: "render-uniforms",
      size: RENDER_UNIFORM_BYTES,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    this.triangleIndexBuffer = device.createBuffer({
      label: "cloth-tris",
      size: mesh.triangleIndices.byteLength,
      usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST,
    });
    device.queue.writeBuffer(this.triangleIndexBuffer, 0, mesh.triangleIndices);

    this.lineIndexBuffer = device.createBuffer({
      label: "cloth-lines",
      size: mesh.lineIndices.byteLength,
      usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST,
    });
    device.queue.writeBuffer(this.lineIndexBuffer, 0, mesh.lineIndices);

    const ico = buildIcosahedron();
    this.markerVertexBuffer = device.createBuffer({
      label: "marker-verts",
      size: ico.positions.byteLength,
      usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
    });
    device.queue.writeBuffer(this.markerVertexBuffer, 0, ico.positions);
    this.markerIndexBuffer = device.createBuffer({
      label: "marker-idx",
      size: ico.indices.byteLength,
      usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST,
    });
    device.queue.writeBuffer(this.markerIndexBuffer, 0, ico.indices);
    this.markerIndexCount = ico.indices.length;

    const module = device.createShaderModule({ label: "pbd-render", code: renderWgsl });
    const bindGroupLayout = device.createBindGroupLayout({
      entries: [
        {
          binding: 0,
          visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
          buffer: { type: "read-only-storage" },
        },
        {
          binding: 1,
          visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
          buffer: { type: "uniform" },
        },
      ],
    });
    const pipelineLayout = device.createPipelineLayout({ bindGroupLayouts: [bindGroupLayout] });

    const depthStencil: GPUDepthStencilState = {
      format: "depth24plus",
      depthWriteEnabled: true,
      depthCompare: "less",
    };

    this.clothPipeline = device.createRenderPipeline({
      label: "cloth-tris",
      layout: pipelineLayout,
      vertex: { module, entryPoint: "vs_cloth" },
      fragment: {
        module,
        entryPoint: "fs_cloth",
        targets: [
          {
            format,
            blend: {
              color: {
                srcFactor: "src-alpha",
                dstFactor: "one-minus-src-alpha",
                operation: "add",
              },
              alpha: { srcFactor: "one", dstFactor: "one-minus-src-alpha", operation: "add" },
            },
          },
        ],
      },
      primitive: { topology: "triangle-list", cullMode: "none" },
      depthStencil,
      multisample: { count: sampleCount },
    });

    this.wirePipeline = device.createRenderPipeline({
      label: "cloth-wire",
      layout: pipelineLayout,
      vertex: { module, entryPoint: "vs_wire" },
      fragment: { module, entryPoint: "fs_wire", targets: [{ format }] },
      primitive: {
        topology: "line-list",
        cullMode: "none",
        unclippedDepth: false,
      },
      depthStencil: {
        ...depthStencil,
        depthCompare: "less-equal",
        depthBias: -2,
        depthBiasSlopeScale: -1,
      },
      multisample: { count: sampleCount },
    });

    this.markerPipeline = device.createRenderPipeline({
      label: "markers",
      layout: pipelineLayout,
      vertex: {
        module,
        entryPoint: "vs_marker",
        buffers: [
          {
            arrayStride: 12,
            attributes: [{ shaderLocation: 0, offset: 0, format: "float32x3" }],
          },
        ],
      },
      fragment: { module, entryPoint: "fs_marker", targets: [{ format }] },
      primitive: { topology: "triangle-list", cullMode: "none" },
      depthStencil,
      multisample: { count: sampleCount },
    });

    this.bindGroup = device.createBindGroup({
      layout: bindGroupLayout,
      entries: [
        { binding: 0, resource: { buffer: this.particleBuffer } },
        { binding: 1, resource: { buffer: this.uniformBuffer } },
      ],
    });
  }

  resize(width: number, height: number) {
    if (width === this.width && height === this.height && this.depthTexture) return;
    this.width = Math.max(1, width);
    this.height = Math.max(1, height);
    this.depthTexture?.destroy();
    this.msaaTexture?.destroy();

    const size = { width: this.width, height: this.height };
    this.depthTexture = this.gpu.device.createTexture({
      label: "depth",
      size,
      format: "depth24plus",
      sampleCount: this.gpu.sampleCount,
      usage: GPUTextureUsage.RENDER_ATTACHMENT,
    });
    if (this.gpu.sampleCount > 1) {
      this.msaaTexture = this.gpu.device.createTexture({
        label: "msaa",
        size,
        format: this.gpu.format,
        sampleCount: this.gpu.sampleCount,
        usage: GPUTextureUsage.RENDER_ATTACHMENT,
      });
    } else {
      this.msaaTexture = null;
    }
  }

  draw(encoder: GPUCommandEncoder, camera: OrbitCamera) {
    this.writeUniforms(camera);
    const canvasView = this.gpu.context.getCurrentTexture().createView();
    if (!this.depthTexture) return;

    const colorAttachment: GPURenderPassColorAttachment = this.msaaTexture
      ? {
          view: this.msaaTexture.createView(),
          resolveTarget: canvasView,
          clearValue: { r: 0.173, g: 0.173, b: 0.18, a: 1 },
          loadOp: "clear",
          storeOp: "discard",
        }
      : {
          view: canvasView,
          clearValue: { r: 0.173, g: 0.173, b: 0.18, a: 1 },
          loadOp: "clear",
          storeOp: "store",
        };

    const pass = encoder.beginRenderPass({
      colorAttachments: [colorAttachment],
      depthStencilAttachment: {
        view: this.depthTexture.createView(),
        depthClearValue: 1,
        depthLoadOp: "clear",
        depthStoreOp: "store",
      },
    });

    pass.setBindGroup(0, this.bindGroup);

    pass.setPipeline(this.clothPipeline);
    pass.setIndexBuffer(this.triangleIndexBuffer, "uint32");
    pass.drawIndexed(this.mesh.triangleIndices.length);

    pass.setPipeline(this.wirePipeline);
    pass.setIndexBuffer(this.lineIndexBuffer, "uint32");
    pass.drawIndexed(this.mesh.lineIndices.length);

    pass.setPipeline(this.markerPipeline);
    pass.setVertexBuffer(0, this.markerVertexBuffer);
    pass.setIndexBuffer(this.markerIndexBuffer, "uint16");
    pass.drawIndexed(this.markerIndexCount, 5);

    pass.end();
  }

  private writeUniforms(camera: OrbitCamera) {
    const f = this.uniformF;
    const u = this.uniformU;
    f.set(camera.viewProj, 0);
    f[16] = camera.eye[0];
    f[17] = camera.eye[1];
    f[18] = camera.eye[2];
    f[19] = 1;
    // Light from above-front, roughly along the camera diagonal.
    f[20] = 0.35;
    f[21] = -0.55;
    f[22] = 0.76;
    f[23] = 0;
    // Cloth: grey, slightly translucent.
    f[24] = 0.62;
    f[25] = 0.62;
    f[26] = 0.65;
    f[27] = 0.92;
    f[28] = 0.07;
    f[29] = 0.07;
    f[30] = 0.08;
    f[31] = 1;
    const c = this.mesh.cornerIndices;
    u[32] = c[0];
    u[33] = c[1];
    u[34] = c[2];
    u[35] = c[3];
    u[36] = this.mesh.centerIndex;
    f[37] = CONFIG.markerRadius;
    f[38] = 0;
    f[39] = 0;
    this.gpu.device.queue.writeBuffer(this.uniformBuffer, 0, this.uniformData);
  }

  destroy() {
    this.uniformBuffer.destroy();
    this.triangleIndexBuffer.destroy();
    this.lineIndexBuffer.destroy();
    this.markerVertexBuffer.destroy();
    this.markerIndexBuffer.destroy();
    this.depthTexture?.destroy();
    this.msaaTexture?.destroy();
  }
}
