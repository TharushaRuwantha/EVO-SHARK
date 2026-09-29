import { CONFIG } from './config';
import { InputManager } from './input';

export class Camera {
  public x: number = 0;       // Pan offset in screen pixels
  public y: number = 0;       // Pan offset in screen pixels
  public zoom: number = 1.0;  // Scale factor (clamped 0.3 to 3.0)
  public followTarget: { x: number; y: number } | null = null;
  public isFollowing: boolean = false;

  private isDragging: boolean = false;
  private lastMouseX: number = 0;
  private lastMouseY: number = 0;
  private canvas: HTMLCanvasElement;
  private input: InputManager;

  // Tracks whether the most recent pointer-down/up pair moved enough to
  // count as a pan rather than a plain click, so a canvas click handler
  // (e.g. "select this creature") can tell a drag-to-explore gesture apart
  // from an actual click on a creature.
  private dragAccum: number = 0;
  private didDragSincePointerDown: boolean = false;
  private static readonly DRAG_CLICK_THRESHOLD_PX = 5;

  constructor(canvas: HTMLCanvasElement, input: InputManager) {
    this.canvas = canvas;
    this.input = input;

    this.handleWheel = this.handleWheel.bind(this);
    this.handleMouseDown = this.handleMouseDown.bind(this);
    this.handleMouseMove = this.handleMouseMove.bind(this);
    this.handleMouseUp = this.handleMouseUp.bind(this);
    this.handleContextMenu = this.handleContextMenu.bind(this);

    canvas.addEventListener('wheel', this.handleWheel, { passive: false });
    canvas.addEventListener('mousedown', this.handleMouseDown);
    window.addEventListener('mousemove', this.handleMouseMove);
    window.addEventListener('mouseup', this.handleMouseUp);
    canvas.addEventListener('contextmenu', this.handleContextMenu);

    this.fitToScreen();
  }

  public destroy(): void {
    this.canvas.removeEventListener('wheel', this.handleWheel);
    this.canvas.removeEventListener('mousedown', this.handleMouseDown);
    window.removeEventListener('mousemove', this.handleMouseMove);
    window.removeEventListener('mouseup', this.handleMouseUp);
    this.canvas.removeEventListener('contextmenu', this.handleContextMenu);
  }

  /**
   * Fill the whole viewport with the ocean, edge-to-edge (a "cover" fit,
   * not "contain"): the world is scaled up just enough that it always
   * spans the full screen with no letterboxed border, at the cost of
   * cropping some of the world off-screen when its aspect ratio doesn't
   * match the window's. That's fine here since panning is always available
   * to explore the cropped areas.
   */
  public fitToScreen(): void {
    const cw = this.canvas.clientWidth || window.innerWidth;
    const ch = this.canvas.clientHeight || window.innerHeight;
    if (cw === 0 || ch === 0) return;

    const scaleX = cw / CONFIG.world.width;
    const scaleY = ch / CONFIG.world.height;
    const fitScale = Math.max(scaleX, scaleY);

    this.zoom = Math.max(CONFIG.camera.minZoom, Math.min(CONFIG.camera.maxZoom, fitScale));
    this.x = (cw - CONFIG.world.width * this.zoom) / 2;
    this.y = (ch - CONFIG.world.height * this.zoom) / 2;
  }

  public applyTransform(ctx: CanvasRenderingContext2D): void {
    ctx.translate(this.x, this.y);
    ctx.scale(this.zoom, this.zoom);
  }

  public setFollow(follow: boolean): void {
    this.isFollowing = follow;
    this.input.cameraFollow = follow;
  }

  public update(): void {
    if (this.isFollowing && this.followTarget) {
      const cw = this.canvas.clientWidth || window.innerWidth;
      const ch = this.canvas.clientHeight || window.innerHeight;
      const targetX = cw / 2 - this.followTarget.x * this.zoom;
      const targetY = ch / 2 - this.followTarget.y * this.zoom;

      // Soft lerp for silky smooth camera tracking
      this.x += (targetX - this.x) * 0.15;
      this.y += (targetY - this.y) * 0.15;
    }
  }

  /**
   * Convert screen coordinates to world coordinates
   */
  public screenToWorld(sx: number, sy: number): { x: number; y: number } {
    return {
      x: (sx - this.x) / this.zoom,
      y: (sy - this.y) / this.zoom,
    };
  }

  /**
   * Convert world coordinates to screen coordinates
   */
  public worldToScreen(wx: number, wy: number): { x: number; y: number } {
    return {
      x: wx * this.zoom + this.x,
      y: wy * this.zoom + this.y,
    };
  }

  private handleWheel(e: WheelEvent): void {
    e.preventDefault();

    const rect = this.canvas.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;

    // World position under cursor before zoom
    const worldBefore = this.screenToWorld(mouseX, mouseY);

    const zoomFactor = e.deltaY < 0 ? 1.12 : 0.89;
    const newZoom = Math.max(
      CONFIG.camera.minZoom,
      Math.min(CONFIG.camera.maxZoom, this.zoom * zoomFactor)
    );

    if (newZoom !== this.zoom) {
      this.zoom = newZoom;
      // Adjust camera x/y so cursor remains at same world point
      this.x = mouseX - worldBefore.x * this.zoom;
      this.y = mouseY - worldBefore.y * this.zoom;
    }
  }

  private handleMouseDown(e: MouseEvent): void {
    // Any plain left-click-drag pans the camera so the map can be explored
    // freely, in addition to the classic middle-drag / Space-drag.
    const isMiddle = e.button === 1;
    const isLeftDrag = e.button === 0;

    if (isMiddle || isLeftDrag) {
      this.isDragging = true;
      this.dragAccum = 0;
      this.lastMouseX = e.clientX;
      this.lastMouseY = e.clientY;
      if (isMiddle) e.preventDefault();
    }
  }

  private handleMouseMove(e: MouseEvent): void {
    if (!this.isDragging) return;

    const dx = e.clientX - this.lastMouseX;
    const dy = e.clientY - this.lastMouseY;
    this.lastMouseX = e.clientX;
    this.lastMouseY = e.clientY;
    this.dragAccum += Math.abs(dx) + Math.abs(dy);

    this.x += dx;
    this.y += dy;

    // Dragging manually breaks hard follow so user has full control
    if (this.isFollowing) {
      this.setFollow(false);
    }
  }

  private handleMouseUp(e: MouseEvent): void {
    if (this.isDragging && (e.button === 1 || e.button === 0)) {
      this.didDragSincePointerDown = this.dragAccum > Camera.DRAG_CLICK_THRESHOLD_PX;
      this.isDragging = false;
    }
  }

  /**
   * Whether the pointer moved far enough between its last down/up pair to
   * count as a map-panning drag rather than a click. Consuming it resets
   * the flag, so a canvas click handler can call this once per click to
   * decide whether to treat that click as a selection or ignore it because
   * the user was just exploring the map.
   */
  public consumeDidDrag(): boolean {
    const v = this.didDragSincePointerDown;
    this.didDragSincePointerDown = false;
    return v;
  }

  public get isPanning(): boolean {
    return this.isDragging;
  }

  private handleContextMenu(e: MouseEvent): void {
    e.preventDefault();
  }
}
