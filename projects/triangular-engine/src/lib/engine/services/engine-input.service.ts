import { Injectable } from '@angular/core';
import { BehaviorSubject, Subject } from 'rxjs';

export type EngineInputAction =
  | 'pressed'
  | 'released'
  | 'value';

/** Framework-independent input abstraction layered over the engine's DOM events. */
@Injectable()
export class EngineInputService {
  readonly actions$ = new Subject<{ action: string; type: EngineInputAction; value: number }>();
  readonly pointer$ = new BehaviorSubject<{ x: number; y: number; buttons: number }>({ x: 0, y: 0, buttons: 0 });
  private readonly bindings = new Map<string, string>();
  private readonly pressed = new Map<string, Set<string>>();

  bind(action: string, ...keys: string[]): void {
    for (const key of keys) this.bindings.set(key, action);
  }

  unbind(action: string): void {
    for (const [key, value] of this.bindings) if (value === action) this.bindings.delete(key);
  }

  handleKeyDown(event: KeyboardEvent): void {
    if (isEditableTarget(event.target)) return;
    const action = this.bindings.get(event.code) ?? this.bindings.get(event.key);
    if (!action) return;
    const keys = this.pressed.get(action) ?? new Set<string>();
    if (keys.has(event.code)) return;
    const wasPressed = keys.size > 0;
    keys.add(event.code);
    this.pressed.set(action, keys);
    if (!wasPressed) this.actions$.next({ action, type: 'pressed', value: 1 });
  }

  handleKeyUp(event: KeyboardEvent): void {
    if (isEditableTarget(event.target)) return;
    const action = this.bindings.get(event.code) ?? this.bindings.get(event.key);
    if (!action) return;
    const keys = this.pressed.get(action);
    if (!keys) return;
    keys.delete(event.code);
    if (keys.size === 0) {
      this.pressed.delete(action);
      this.actions$.next({ action, type: 'released', value: 0 });
    }
  }

  /** Clears held actions when focus leaves the scene so controls cannot stick. */
  clear(): void {
    for (const action of this.pressed.keys()) {
      this.actions$.next({ action, type: 'released', value: 0 });
    }
    this.pressed.clear();
  }

  handlePointer(event: PointerEvent): void {
    this.pointer$.next({ x: event.clientX, y: event.clientY, buttons: event.buttons });
  }
}

function isEditableTarget(target: EventTarget | null): boolean {
  return target instanceof HTMLElement &&
    (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement ||
      target instanceof HTMLSelectElement || target.isContentEditable);
}
