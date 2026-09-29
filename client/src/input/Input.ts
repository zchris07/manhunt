/** Keyboard and mouse state for the game canvas. Codes are KeyboardEvent.code values. */
export class Input {
  private readonly down = new Set<string>();
  private readonly pressedOnce = new Set<string>();
  mouseX = 0;
  mouseY = 0;
  readonly buttons = [false, false, false];
  enabled = true;

  constructor(private readonly target: HTMLElement) {
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', this.onBlur);
    target.addEventListener('mousemove', this.onMouseMove);
    target.addEventListener('mousedown', this.onMouseDown);
    window.addEventListener('mouseup', this.onMouseUp);
    target.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  private isTyping(e: Event): boolean {
    const el = e.target as HTMLElement | null;
    return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable);
  }

  private onKeyDown = (e: KeyboardEvent): void => {
    if (this.isTyping(e) || !this.enabled) return;
    if (!this.down.has(e.code)) this.pressedOnce.add(e.code);
    this.down.add(e.code);
    if (['Space', 'Tab'].includes(e.code)) e.preventDefault();
  };

  private onKeyUp = (e: KeyboardEvent): void => {
    this.down.delete(e.code);
  };

  private onBlur = (): void => {
    this.down.clear();
    this.buttons.fill(false);
  };

  private onMouseMove = (e: MouseEvent): void => {
    const r = this.target.getBoundingClientRect();
    this.mouseX = e.clientX - r.left;
    this.mouseY = e.clientY - r.top;
  };

  private onMouseDown = (e: MouseEvent): void => {
    if (!this.enabled) return;
    if (e.button < 3) this.buttons[e.button] = true;
    this.pressedOnce.add(`Mouse${e.button}`);
  };

  private onMouseUp = (e: MouseEvent): void => {
    if (e.button < 3) this.buttons[e.button] = false;
  };

  isDown(code: string): boolean {
    return this.enabled && this.down.has(code);
  }

  /** True once per physical press; cleared by endFrame(). */
  wasPressed(code: string): boolean {
    return this.enabled && this.pressedOnce.has(code);
  }

  endFrame(): void {
    this.pressedOnce.clear();
  }

  axis(): { x: number; y: number } {
    let x = 0;
    let y = 0;
    if (this.isDown('KeyA') || this.isDown('ArrowLeft')) x -= 1;
    if (this.isDown('KeyD') || this.isDown('ArrowRight')) x += 1;
    if (this.isDown('KeyW') || this.isDown('ArrowUp')) y -= 1;
    if (this.isDown('KeyS') || this.isDown('ArrowDown')) y += 1;
    const l = Math.hypot(x, y);
    return l > 0 ? { x: x / l, y: y / l } : { x: 0, y: 0 };
  }

  destroy(): void {
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('blur', this.onBlur);
    window.removeEventListener('mouseup', this.onMouseUp);
    this.target.removeEventListener('mousemove', this.onMouseMove);
    this.target.removeEventListener('mousedown', this.onMouseDown);
  }
}
