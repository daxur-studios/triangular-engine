import { Directive, DestroyRef, TemplateRef, ViewContainerRef, afterNextRender, inject, input } from '@angular/core';
import { TemplatePortal } from '@angular/cdk/portal';

import { EnginePortalArea, EnginePortalLane } from './engine-portal.models';
import { EnginePortalService } from './engine-portal.service';

/**
 * Registers an `<ng-template>` as engine UI portal content.
 *
 * Value: allows consumer components/pages to project content dynamically to the HUD areas
 * of the engine, automatically cleaning up the portal on component destruction.
 *
 * Usage: `<ng-template enginePortal="top" lane="content" [order]="1">...</ng-template>`
 */
@Directive({
  selector: '[enginePortal]',
  standalone: true,
})
export class EnginePortalDirective {
  readonly area = input.required<EnginePortalArea>({ alias: 'enginePortal' });
  readonly lane = input<EnginePortalLane>('content');
  readonly order = input<number>(0);

  private readonly templateRef = inject(TemplateRef<unknown>);
  private readonly viewContainerRef = inject(ViewContainerRef);
  private readonly portalService = inject(EnginePortalService);
  private readonly destroyRef = inject(DestroyRef);

  constructor() {
    afterNextRender(() => {
      const portal = new TemplatePortal(this.templateRef, this.viewContainerRef);
      const entryId = this.portalService.registerEntry(
        this.area(),
        this.lane(),
        this.order(),
        portal
      );
      this.destroyRef.onDestroy(() => this.portalService.unregisterEntry(entryId));
    });
  }
}
