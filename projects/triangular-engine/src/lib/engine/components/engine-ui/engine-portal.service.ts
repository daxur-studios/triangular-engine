import { Injectable, Signal, signal } from '@angular/core';
import { TemplatePortal } from '@angular/cdk/portal';

import { EnginePortalArea, EnginePortalLane, EnginePortalEntry } from './engine-portal.models';

/**
 * Owns page/component-provided engine portals registered into named layout areas.
 *
 * Value: serves as a central registry for all HUD overlay templates, allowing components/pages
 * to dynamically inject controls into top/bottom toolbars, left/right sidebars, and main content area.
 */
@Injectable({ providedIn: 'root' })
export class EnginePortalService {
  private readonly registeredEntries = signal<readonly EnginePortalEntry[]>([]);
  private nextEntrySequence = 0;

  /** All currently registered entries across all areas. */
  readonly entries: Signal<readonly EnginePortalEntry[]> = this.registeredEntries.asReadonly();

  /** Registers a template portal into an area/lane and returns its entry ID for cleanup. */
  registerEntry(
    area: EnginePortalArea,
    lane: EnginePortalLane,
    order: number,
    portal: TemplatePortal
  ): string {
    const id = `engine-portal-${this.nextEntrySequence++}`;
    this.registeredEntries.update((entries) => [
      ...entries,
      { id, area, lane, order, portal },
    ]);
    return id;
  }

  /** Removes a previously registered entry. */
  unregisterEntry(id: string): void {
    this.registeredEntries.update((entries) =>
      entries.filter((entry) => entry.id !== id)
    );
  }
}
