import type { InputState } from '../types';

export interface InputCallbacks {
  onPauseToggle?: () => void;
  onSelectChoice?: (index: number) => void;
  onFirstInteraction?: () => void;
}

const DEADZONE = 8;
const MAX_RADIUS = 56;
const FOLLOW_RADIUS = MAX_RADIUS * 1.4;
const INTERACTIVE_SELECTOR = 'button, input, select, textarea, a, label, [role="button"]';

/**
 * Unified floating virtual joystick (Pointer Events) + keyboard input controller.
 * Reuses a single `InputState` instance to avoid per-frame allocations.
 */
export class InputController {
  private readonly target: HTMLElement;
  private readonly callbacks?: InputCallbacks;
  private readonly keys = new Set<string>();

  private activePointerId: number | null = null;
  private pointerActive = false;
  private originX = 0;
  private originY = 0;
  private currentX = 0;
  private currentY = 0;
  private rectLeft = 0;
  private rectTop = 0;
  private hasInteracted = false;
  private destroyed = false;

  private readonly state: InputState = {
    moveX: 0,
    moveY: 0,
    magnitude: 0,
    active: false,
    originX: 0,
    originY: 0,
    currentX: 0,
    currentY: 0,
    pointerActive: false,
  };

  constructor(target: HTMLElement, callbacks?: InputCallbacks) {
    this.target = target;
    this.callbacks = callbacks;

    this.target.addEventListener('pointerdown', this.handlePointerDown, { passive: false });
    this.target.addEventListener('pointermove', this.handlePointerMove, { passive: false });
    this.target.addEventListener('pointerup', this.handlePointerEnd);
    this.target.addEventListener('pointercancel', this.handlePointerEnd);

    window.addEventListener('pointerup', this.handlePointerEnd);
    window.addEventListener('pointercancel', this.handlePointerEnd);
    window.addEventListener('keydown', this.handleKeyDown);
    window.addEventListener('keyup', this.handleKeyUp);
    window.addEventListener('blur', this.handleWindowBlur);
  }

  private triggerFirstInteraction(): void {
    if (this.hasInteracted) return;
    this.hasInteracted = true;
    this.callbacks?.onFirstInteraction?.();
  }

  private readonly handlePointerDown = (e: PointerEvent): void => {
    if (this.destroyed) return;
    this.triggerFirstInteraction();

    if (!e.isPrimary) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    if (this.activePointerId !== null) return;

    const eventTarget = e.target;
    if (eventTarget instanceof Element && eventTarget.closest(INTERACTIVE_SELECTOR) !== null) {
      return;
    }

    if (e.cancelable) {
      e.preventDefault();
    }

    const rect = this.target.getBoundingClientRect();
    this.rectLeft = rect.left;
    this.rectTop = rect.top;

    const x = e.clientX - this.rectLeft;
    const y = e.clientY - this.rectTop;

    this.activePointerId = e.pointerId;
    this.pointerActive = true;
    this.originX = x;
    this.originY = y;
    this.currentX = x;
    this.currentY = y;

    try {
      this.target.setPointerCapture(e.pointerId);
    } catch {
      // Ignore if pointer capture is unavailable (e.g. synthetic events).
    }
  };

  private readonly handlePointerMove = (e: PointerEvent): void => {
    if (this.destroyed || !this.pointerActive || e.pointerId !== this.activePointerId) {
      return;
    }

    if (e.cancelable) {
      e.preventDefault();
    }

    this.currentX = e.clientX - this.rectLeft;
    this.currentY = e.clientY - this.rectTop;

    const dx = this.currentX - this.originX;
    const dy = this.currentY - this.originY;
    const dist = Math.hypot(dx, dy);

    if (dist > FOLLOW_RADIUS) {
      const scale = (dist - FOLLOW_RADIUS) / dist;
      this.originX += dx * scale;
      this.originY += dy * scale;
    }
  };

  private readonly handlePointerEnd = (e: PointerEvent): void => {
    if (!this.pointerActive || e.pointerId !== this.activePointerId) {
      return;
    }

    this.activePointerId = null;
    this.pointerActive = false;

    try {
      if (this.target.hasPointerCapture(e.pointerId)) {
        this.target.releasePointerCapture(e.pointerId);
      }
    } catch {
      // Ignore if pointer capture is unavailable.
    }
  };

  private readonly handleKeyDown = (e: KeyboardEvent): void => {
    if (this.destroyed) return;

    const eventTarget = e.target;
    if (
      eventTarget instanceof HTMLElement &&
      (eventTarget.tagName === 'INPUT' ||
        eventTarget.tagName === 'TEXTAREA' ||
        eventTarget.tagName === 'SELECT')
    ) {
      return;
    }

    this.triggerFirstInteraction();

    switch (e.code) {
      case 'ArrowUp':
      case 'ArrowDown':
      case 'ArrowLeft':
      case 'ArrowRight':
        if (e.cancelable) e.preventDefault();
        this.keys.add(e.code);
        break;
      case 'KeyW':
      case 'KeyA':
      case 'KeyS':
      case 'KeyD':
        this.keys.add(e.code);
        break;
      case 'Escape':
      case 'KeyP':
        if (!e.repeat) {
          this.callbacks?.onPauseToggle?.();
        }
        break;
      case 'Digit1':
        if (!e.repeat) {
          this.callbacks?.onSelectChoice?.(0);
        }
        break;
      case 'Digit2':
        if (!e.repeat) {
          this.callbacks?.onSelectChoice?.(1);
        }
        break;
      case 'Digit3':
        if (!e.repeat) {
          this.callbacks?.onSelectChoice?.(2);
        }
        break;
      default:
        break;
    }
  };

  private readonly handleKeyUp = (e: KeyboardEvent): void => {
    this.keys.delete(e.code);
  };

  private readonly handleWindowBlur = (): void => {
    this.reset();
  };

  /**
   * Updates and returns the shared `InputState` snapshot without allocating.
   */
  public getState(): InputState {
    let moveX = 0;
    let moveY = 0;
    let magnitude = 0;
    let active = false;

    if (this.pointerActive) {
      const dx = this.currentX - this.originX;
      const dy = this.currentY - this.originY;
      const dist = Math.hypot(dx, dy);

      if (dist > DEADZONE) {
        const clamped = (dist - DEADZONE) / (MAX_RADIUS - DEADZONE);
        magnitude = clamped > 1 ? 1 : clamped;
        const invDist = 1 / dist;
        moveX = dx * invDist * magnitude;
        moveY = dy * invDist * magnitude;
      }
      active = true;
    }

    if (magnitude === 0) {
      const kx =
        (this.keys.has('KeyD') || this.keys.has('ArrowRight') ? 1 : 0) -
        (this.keys.has('KeyA') || this.keys.has('ArrowLeft') ? 1 : 0);
      const ky =
        (this.keys.has('KeyS') || this.keys.has('ArrowDown') ? 1 : 0) -
        (this.keys.has('KeyW') || this.keys.has('ArrowUp') ? 1 : 0);

      if (kx !== 0 || ky !== 0) {
        const invLen = 1 / Math.hypot(kx, ky);
        moveX = kx * invLen;
        moveY = ky * invLen;
        magnitude = 1;
        active = true;
      }
    }

    this.state.moveX = moveX;
    this.state.moveY = moveY;
    this.state.magnitude = magnitude;
    this.state.active = active;
    this.state.originX = this.originX;
    this.state.originY = this.originY;
    this.state.currentX = this.currentX;
    this.state.currentY = this.currentY;
    this.state.pointerActive = this.pointerActive;

    return this.state;
  }

  /**
   * Clears all active pointer and keyboard inputs.
   */
  public reset(): void {
    this.keys.clear();
    if (this.activePointerId !== null) {
      try {
        if (this.target.hasPointerCapture(this.activePointerId)) {
          this.target.releasePointerCapture(this.activePointerId);
        }
      } catch {
        // Ignore if pointer capture is unavailable.
      }
    }
    this.activePointerId = null;
    this.pointerActive = false;
    this.originX = 0;
    this.originY = 0;
    this.currentX = 0;
    this.currentY = 0;

    this.state.moveX = 0;
    this.state.moveY = 0;
    this.state.magnitude = 0;
    this.state.active = false;
    this.state.originX = 0;
    this.state.originY = 0;
    this.state.currentX = 0;
    this.state.currentY = 0;
    this.state.pointerActive = false;
  }

  /**
   * Detaches all DOM and window listeners.
   */
  public destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.reset();

    this.target.removeEventListener('pointerdown', this.handlePointerDown);
    this.target.removeEventListener('pointermove', this.handlePointerMove);
    this.target.removeEventListener('pointerup', this.handlePointerEnd);
    this.target.removeEventListener('pointercancel', this.handlePointerEnd);

    window.removeEventListener('pointerup', this.handlePointerEnd);
    window.removeEventListener('pointercancel', this.handlePointerEnd);
    window.removeEventListener('keydown', this.handleKeyDown);
    window.removeEventListener('keyup', this.handleKeyUp);
    window.removeEventListener('blur', this.handleWindowBlur);
  }
}
