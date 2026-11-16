/* eslint-disable @typescript-eslint/no-explicit-any */
import { uniform } from 'three/tsl';
import type { PlanetAtmosphere } from 'triangular-engine/atmosphere';
import type { PlanetCloudShell } from 'triangular-engine/cloud-volumes';

/** What the page drives. */
export interface ICloudGroundShadowsSpikeSceneHandle {
  /** 0 turns the shadow off (the stage still runs, so there is no recompile); 1 is a full-strength cloud shadow. */
  setStrength(strength: number): void;
  dispose(): void;
}

/** What the mechanism reads: the three pieces the page already has. */
export interface ICloudGroundShadowsSpikeInput {
  /** The atmosphere whose binding's lighting stage is wrapped. */
  readonly atmosphere: PlanetAtmosphere;
  /** The cloud shell: its `groundShadowAt` is the shadow, read from its own sun, radius and height. */
  readonly shell: PlanetCloudShell;
  /** The terrain's material: anything with the planet material's lighting stage setter. */
  readonly surface: { setLightingStage(entry: { id: string; stage: any } | null): unknown };
}

/**
 * Spike mechanism: the ground's cloud shadow without a ray march. The shell's `groundShadowAt` reads the cloud density
 * where the sun's ray from the ground crosses the cloud layer; it goes in as `directShadow` of the atmosphere's lighting
 * stage, which scales only the direct sun term.
 * @returns A handle with `setStrength` and `dispose`.
 */
export function createCloudGroundShadowsSpikeScene(input: ICloudGroundShadowsSpikeInput): ICloudGroundShadowsSpikeSceneHandle {
  const { atmosphere, shell, surface } = input;
  const uStrength: any = uniform(1);

  const stage = atmosphere.binding.lighting({
    directShadow: (context: any) => shell.groundShadowAt(context.radialDirection, uStrength),
  });
  surface.setLightingStage({ id: 'atmosphere', stage });

  return {
    setStrength(strength: number): void {
      uStrength.value = strength;
    },
    dispose(): void {
      surface.setLightingStage(null);
    },
  };
}
