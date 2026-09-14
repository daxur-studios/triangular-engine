import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { ICellPlanetSelection } from './cell-planet-terrain-selection';

/**
 * Readout for the currently selected world cell. Presentation-only: the 2.5D page owns
 * selection state and passes it in, so this stays reusable and does not know about picking.
 */
@Component({
  selector: 'app-cell-planet-selection-panel',
  template: `
    @if (selection(); as cell) {
      <div class="selection">
        <div class="selection-head">
          <strong>Selected cell #{{ cell.cellId }}</strong>
          <button type="button" (click)="clearSelection.emit()">Clear</button>
        </div>
        <dl>
          <div><dt>Biome</dt><dd>{{ cell.biome }}</dd></div>
          <div><dt>Elevation</dt><dd>{{ cell.elevation.toFixed(3) }}</dd></div>
          <div><dt>Temperature</dt><dd>{{ cell.temperature.toFixed(3) }}</dd></div>
          <div><dt>Moisture</dt><dd>{{ cell.moisture.toFixed(3) }}</dd></div>
          <div><dt>Surface</dt><dd>{{ cell.isLand ? 'land' : 'water' }}</dd></div>
        </dl>
      </div>
    } @else {
      <span>Click terrain to select a cell.</span>
    }
  `,
  styles: [
    `
      .selection {
        display: grid;
        gap: 0.3rem;
      }

      .selection-head {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 0.5rem;
      }

      dl {
        display: grid;
        grid-template-columns: auto auto;
        gap: 0.1rem 0.75rem;
        margin: 0;
      }

      dl > div {
        display: contents;
      }

      dt {
        color: #8fb0cc;
      }

      dd {
        margin: 0;
        text-align: right;
      }

      button {
        padding: 0.15rem 0.4rem;
        border: 1px solid rgb(255 255 255 / 20%);
        border-radius: 0.25rem;
        background: transparent;
        color: inherit;
        font: inherit;
        cursor: pointer;
      }
    `,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CellPlanetSelectionPanelComponent {
  readonly selection = input<ICellPlanetSelection | null>(null);
  readonly clearSelection = output<void>();
}
