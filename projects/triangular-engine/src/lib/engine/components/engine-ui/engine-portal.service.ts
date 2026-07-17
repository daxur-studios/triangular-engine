import { Injectable, Signal, computed, inject } from '@angular/core';
import { TemplatePortal } from '@angular/cdk/portal';
import { PortalRegistryService } from '@daxur-studios/portal-layout';

import { EnginePortalArea, EnginePortalLane, EnginePortalEntry } from './engine-portal.models';

/**
 * Owns page/component-provided engine portals registered into named layout areas.
 *
 * Value: serves as a central registry for all HUD overlay templates, allowing components/pages
 * to dynamically inject controls into top/bottom toolbars, left/right sidebars, and main content area.
 *
 * Adapts to @daxur-studios/portal-layout's PortalRegistryService.
 */
@Injectable({ providedIn: 'root' })
export class EnginePortalService {
  private readonly registry = inject(PortalRegistryService);

  /** All currently registered entries across all areas. */
  readonly entries: Signal<readonly EnginePortalEntry[]> = computed(() =>
    this.registry.entries() as unknown as readonly EnginePortalEntry[]
  );

  /** Registers a template portal into an area/lane and returns its entry ID for cleanup. */
  registerEntry(
    area: EnginePortalArea,
    lane: EnginePortalLane,
    order: number,
    portal: TemplatePortal
  ): string {
    return this.registry.register(area, lane, order, portal);
  }

  /** Removes a previously registered entry. */
  unregisterEntry(id: string): void {
    this.registry.unregister(id);
  }
}
