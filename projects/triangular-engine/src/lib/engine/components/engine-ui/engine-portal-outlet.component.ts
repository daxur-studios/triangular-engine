import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { PortalModule } from '@angular/cdk/portal';

import { EnginePortalArea, EnginePortalLane } from './engine-portal.models';
import { EnginePortalService } from './engine-portal.service';

/**
 * Renders all page/component portals registered into a specific engine layout area.
 *
 * Value: lists, filters, and orders portal components dynamically according to area and lanes
 * to keep UI layout structured.
 */
@Component({
  selector: 'engine-portal-outlet',
  standalone: true,
  imports: [CommonModule, PortalModule],
  template: `
    @for (item of sortedItems(); track item.id) {
      <div class="engine-portal-item-wrapper">
        <ng-template [cdkPortalOutlet]="item.portal"></ng-template>
      </div>
    }
  `,
  styles: [`
    :host {
      display: contents;
    }
    .engine-portal-item-wrapper {
      pointer-events: auto;
    }
  `],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class EnginePortalOutletComponent {
  readonly area = input.required<EnginePortalArea>();

  private readonly portalService = inject(EnginePortalService);

  protected readonly sortedItems = computed(() => {
    const entries = this.portalService.entries();
    return [...entries]
      .filter((entry) => entry.area === this.area())
      .sort((a, b) => {
        // Sort by lane: 'before' first, then 'content', then 'after'
        const laneOrder: Record<EnginePortalLane, number> = {
          before: 0,
          content: 1,
          after: 2,
        };
        const laneDiff = laneOrder[a.lane] - laneOrder[b.lane];
        if (laneDiff !== 0) {
          return laneDiff;
        }
        // Then by order within that lane
        return a.order - b.order;
      });
  });
}
