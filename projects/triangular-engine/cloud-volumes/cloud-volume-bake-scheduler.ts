import type { WebGPURenderer } from 'three/webgpu';
import type { CloudVolume } from './cloud-volume';

/**
 * Spreads cloud-volume rebakes over frames (Plan 051, step 5). Each frame it queues what is stale, then draws at most
 * `bandsPerFrame` atlas bands, taking turns across volumes so one sun move does not stall a frame. A volume keeps
 * marching its old atlas until its bake finishes: there is no cross-fade, so a band can show the new light beside the old.
 */
export class CloudVolumeBakeScheduler {
  /** Atlas bands drawn per frame across all volumes. A volume's bake takes `bakeBands` of them. */
  bandsPerFrame = 2;
  private cursor = 0;

  update(renderer: WebGPURenderer, volumes: readonly CloudVolume[]): number {
    for (const volume of volumes) volume.prepare();
    let drawn = 0;
    let idle = 0;
    while (drawn < this.bandsPerFrame && idle < volumes.length) {
      const volume = volumes[this.cursor % volumes.length];
      this.cursor = (this.cursor + 1) % volumes.length;
      if (volume.hasPendingBake) {
        volume.bakeStep(renderer);
        drawn++;
        idle = 0;
      } else {
        idle++;
      }
    }
    return drawn;
  }
}
