import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import type { ICellDataLayer } from '../cell-data-layers';

/** Reusable native picker for a game's registered cell data layers. */
@Component({
  selector: 'cellDataLayerPicker',
  imports: [],
  templateUrl: './cell-data-layer-picker.component.html',
  styleUrl: './cell-data-layer-picker.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CellDataLayerPickerComponent {
  readonly layers = input<readonly ICellDataLayer[]>([]);
  readonly selectedLayerId = input<string>('');
  readonly selectedLayerIdChange = output<string>();

  onSelectionChange(event: Event): void {
    this.selectedLayerIdChange.emit((event.target as HTMLSelectElement).value);
  }
}
