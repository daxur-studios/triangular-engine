import type { PlanetAtmosphere } from 'triangular-engine/atmosphere';
import type { PlanetCloudShell } from 'triangular-engine/cloud-volumes';
import { createCloudGroundShadowsSpikeScene } from './create-cloud-ground-shadows-spike-scene';

describe('cloud ground shadow spike', () => {
  it('projects from the radial direction, regardless of the terrain slope', () => {
    let shadowAt: ((context: unknown) => unknown) | undefined;
    const atmosphere = {
      binding: { lighting: ({ directShadow }: { directShadow: (context: unknown) => unknown }) => {
        shadowAt = directShadow;
        return () => undefined;
      } },
    } as unknown as PlanetAtmosphere;
    const groundShadowAt = jasmine.createSpy('groundShadowAt');
    const shell = { groundShadowAt } as unknown as PlanetCloudShell;
    const surface = { setLightingStage: jasmine.createSpy('setLightingStage') };
    const handle = createCloudGroundShadowsSpikeScene({ atmosphere, shell, surface });
    const radialDirection = {};

    shadowAt!({ radialDirection, sphereNormal: {} });

    expect(groundShadowAt.calls.mostRecent().args[0]).toBe(radialDirection);
    handle.dispose();
    expect(surface.setLightingStage).toHaveBeenCalledWith(null);
  });
});
