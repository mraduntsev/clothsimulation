import { CONFIG } from "./config";
import { lookAt, multiply4, perspective, perspectiveGL, type Vec3 } from "./math";

/**
 * Z-up orbit camera. Yaw rotates around world +Z; pitch is elevation above
 * the XY plane. Matches the reference view (diagonal, slightly above the sheet).
 */
export class OrbitCamera {
  yaw = CONFIG.camera.yaw;
  pitch = CONFIG.camera.pitch;
  distance = CONFIG.camera.distance;
  target: Vec3 = [0, 0, 0];
  readonly eye: Vec3 = [0, 0, 0];

  private readonly proj = new Float32Array(16);
  private readonly projGL = new Float32Array(16);
  private readonly view = new Float32Array(16);
  readonly viewProj = new Float32Array(16);
  readonly viewProjGL = new Float32Array(16);

  private dragging = false;
  private lastX = 0;
  private lastY = 0;
  private pointers = new Map<number, { x: number; y: number }>();
  private pinchDist = 0;
  private canvas: HTMLCanvasElement | null = null;

  attach(canvas: HTMLCanvasElement) {
    this.detach();
    this.canvas = canvas;
    canvas.addEventListener("pointerdown", this.onPointerDown);
    canvas.addEventListener("pointermove", this.onPointerMove);
    canvas.addEventListener("pointerup", this.onPointerUp);
    canvas.addEventListener("pointercancel", this.onPointerUp);
    canvas.addEventListener("wheel", this.onWheel, { passive: false });
    canvas.addEventListener("contextmenu", this.onContextMenu);
  }

  detach() {
    const canvas = this.canvas;
    if (!canvas) return;
    canvas.removeEventListener("pointerdown", this.onPointerDown);
    canvas.removeEventListener("pointermove", this.onPointerMove);
    canvas.removeEventListener("pointerup", this.onPointerUp);
    canvas.removeEventListener("pointercancel", this.onPointerUp);
    canvas.removeEventListener("wheel", this.onWheel);
    canvas.removeEventListener("contextmenu", this.onContextMenu);
    this.canvas = null;
    this.pointers.clear();
    this.dragging = false;
  }

  updateViewProj(aspect: number) {
    const cp = Math.cos(this.pitch);
    const sp = Math.sin(this.pitch);
    const cy = Math.cos(this.yaw);
    const sy = Math.sin(this.yaw);
    this.eye[0] = this.target[0] + this.distance * cp * sy;
    this.eye[1] = this.target[1] - this.distance * cp * cy;
    this.eye[2] = this.target[2] + this.distance * sp;
    lookAt(this.eye, this.target, [0, 0, 1], this.view);
    perspective(CONFIG.camera.fovY, aspect, CONFIG.camera.near, CONFIG.camera.far, this.proj);
    multiply4(this.proj, this.view, this.viewProj);
    perspectiveGL(CONFIG.camera.fovY, aspect, CONFIG.camera.near, CONFIG.camera.far, this.projGL);
    multiply4(this.projGL, this.view, this.viewProjGL);
  }

  private onContextMenu = (e: Event) => e.preventDefault();

  private onPointerDown = (e: PointerEvent) => {
    (e.currentTarget as HTMLCanvasElement).setPointerCapture(e.pointerId);
    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (this.pointers.size === 1) {
      this.dragging = true;
      this.lastX = e.clientX;
      this.lastY = e.clientY;
    } else if (this.pointers.size === 2) {
      this.dragging = false;
      this.pinchDist = this.currentPinch();
    }
  };

  private onPointerMove = (e: PointerEvent) => {
    if (!this.pointers.has(e.pointerId)) return;
    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (this.pointers.size === 2) {
      const d = this.currentPinch();
      if (this.pinchDist > 0 && d > 0) {
        this.dolly(this.pinchDist / d);
        this.pinchDist = d;
      }
      return;
    }
    if (!this.dragging) return;
    const dx = e.clientX - this.lastX;
    const dy = e.clientY - this.lastY;
    this.lastX = e.clientX;
    this.lastY = e.clientY;
    this.yaw += dx * 0.005;
    this.pitch = clamp(this.pitch + dy * 0.004, CONFIG.camera.minPitch, CONFIG.camera.maxPitch);
  };

  private onPointerUp = (e: PointerEvent) => {
    this.pointers.delete(e.pointerId);
    if (this.pointers.size < 2) this.pinchDist = 0;
    if (this.pointers.size === 0) this.dragging = false;
    if (this.pointers.size === 1) {
      const remain = this.pointers.values().next().value;
      if (remain) {
        this.dragging = true;
        this.lastX = remain.x;
        this.lastY = remain.y;
      }
    }
  };

  private onWheel = (e: WheelEvent) => {
    e.preventDefault();
    const factor = Math.exp(e.deltaY * 0.0012);
    this.dolly(factor);
  };

  private dolly(factor: number) {
    this.distance = clamp(
      this.distance * factor,
      CONFIG.camera.minDistance,
      CONFIG.camera.maxDistance,
    );
  }

  private currentPinch(): number {
    const pts = [...this.pointers.values()];
    if (pts.length < 2) return 0;
    return Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
  }
}

function clamp(v: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, v));
}
