import { TemplatePortal } from '@angular/cdk/portal';

/**
 * Named structural regions of the engine UI overlay that a consumer component can contribute content into.
 */
export type EnginePortalArea = 'top' | 'bottom' | 'left' | 'right' | 'main' | 'modal' | 'notification';

/**
 * Internal placement lane inside an engine portal area to define stacking order.
 */
export type EnginePortalLane = 'before' | 'content' | 'after';

/** Every lane, in the order they should stack top-to-bottom or start-to-end inside an area. */
export const ALL_ENGINE_LANES: readonly EnginePortalLane[] = ['before', 'content', 'after'];

/** One dynamic page/component portal registered into an engine portal area/lane. */
export interface EnginePortalEntry {
  readonly id: string;
  readonly area: EnginePortalArea;
  readonly lane: EnginePortalLane;
  readonly order: number;
  readonly portal: TemplatePortal;
}
