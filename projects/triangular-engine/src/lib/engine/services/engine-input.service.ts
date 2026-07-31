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
  private readonly pressed = new Set<string>();

  bind(action: string, ...keys: string[]): void {
    for (const key of keys) this.bindings.set(key, action);
  }

  unbind(action: string): void {
    for (const [key, value] of this.bindings) if (value === action) this.bindings.delete(key);
  }

  handleKeyDown(event: KeyboardEvent): void {
    const action = this.bindings.get(event.code) ?? this.bindings.get(event.key);
    if (!action || this.pressed.has(action)) return;
    this.pressed.add(action);
    this.actions$.next({ action, type: 'pressed', value: 1 });
  }

  handleKeyUp(event: KeyboardEvent): void {
    const action = this.bindings.get(event.code) ?? this.bindings.get(event.key);
    if (!action) return;
    this.pressed.delete(action);
    this.actions$.next({ action, type: 'released', value: 0 });
  }

  handlePointer(event: PointerEvent): void {
    this.pointer$.next({ x: event.clientX, y: event.clientY, buttons: event.buttons });
  }
}
