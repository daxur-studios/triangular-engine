import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { PortalOutletComponent } from '@daxur-studios/portal-layout';

import { EnginePortalArea } from './engine-portal.models';

/**
 * Renders all page/component portals registered into a specific engine layout area.
 *
 * Value: lists, filters, and orders portal components dynamically according to area and lanes
 * to keep UI layout structured.
 *
 * Delegates rendering directly to the unified PortalOutletComponent.
 */
@Component({
  selector: 'engine-portal-outlet',
  standalone: true,
  imports: [CommonModule, PortalOutletComponent],
  template: `
    <portalOutlet [area]="area()"></portalOutlet>
  `,
  styles: [`
    :host {
      display: contents;
    }
  `],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class EnginePortalOutletComponent {
  readonly area = input.required<EnginePortalArea>();
}
