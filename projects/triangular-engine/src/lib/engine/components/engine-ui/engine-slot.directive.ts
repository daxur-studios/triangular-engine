import { Directive, input, Input } from '@angular/core';

export type EngineSlot =
  | 'top'
  | 'left'
  | 'right'
  | 'bottom'
  | 'main'
  | 'modal'
  | 'notification';

@Directive({
  selector: '[engineSlot]',
  standalone: true,
})
export class EngineSlotDirective {
  readonly engineSlot = input.required<EngineSlot>();
}
