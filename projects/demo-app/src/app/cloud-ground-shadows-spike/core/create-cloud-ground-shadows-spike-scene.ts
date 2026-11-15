/* eslint-disable @typescript-eslint/no-explicit-any */
import { Vector3 } from 'three';
import { dot, float, normalize, sqrt, uniform } from 'three/tsl';
import type { PlanetAtmosphere } from 'triangular-engine/atmosphere';
import type { PlanetCloudShell } from 'triangular-engine/cloud-volumes';

/** Per-frame numbers the page shows. */
export interface ICloudGroundShadowsSpikeDiagnostics {
  readonly drawCalls: number;
  readonly triangles: number;
}

/** What the page drives. */
export interface ICloudGroundShadowsSpikeSceneHandle {
  /** 0 turns the shadow off (the stage still runs, so there is no recompile); 1 is a full-strength cloud shadow. */
  setStrength(strength: number): void;
  /** The cloud layer's height above the ground, in world units; must equal the shell's own. */
  setAltitude(altitudeUnits: number): void;
  /** Call once a frame (before render): copies the clouds' sun into the shadow. */
  update(): void;
  dispose(): void;
}

/** What the mechanism reads: the three pieces the page already has. */
export interface ICloudGroundShadowsSpikeInput {
  /** The atmosphere whose binding's lighting stage is wrapped. */
  readonly atmosphere: PlanetAtmosphere;
  /** The cloud shell whose density is read: the same function that draws the clouds. */
  readonly shell: PlanetCloudShell;
  /** The terrain's material: anything with the planet material's lighting stage setter. */
  readonly surface: { setLightingStage(entry: { id: string; stage: any } | null): unknown };
  /** The planet's radius in world units (the ground's, ignoring terrain height: the spike's one approximation). */
  readonly radiusUnits: number;
  /** The cloud band's height above the ground in world units, as the shell was made with. */
  readonly altitudeUnits: number;
}

/**
 * Spike mechanism: the ground's cloud shadow without a ray march. For a ground point `P = R * up` and the sun direction
 * `s`, the sun ray `P + s * t` crosses the cloud shell (radius `R + h`) at one analytic distance
 * `t = -R * mu + sqrt(R^2 * mu^2 + 2 * R * h + h^2)`, where `mu = up . s`. The shell's own density function is read
 * at that crossing's direction, so the shadow sits where the sun's ray meets the cloud that is drawn there.
 *
 * The result is passed as `directShadow` to the atmosphere's lighting stage, which scales only the direct sun term.
 * @returns A handle with `setStrength` and `dispose`.
 */
export function createCloudGroundShadowsSpikeScene(input: ICloudGroundShadowsSpikeInput): ICloudGroundShadowsSpikeSceneHandle {
  const { atmosphere, shell, surface, radiusUnits: R, altitudeUnits: h } = input;
  const uStrength: any = uniform(1);
  const uSun: any = uniform(new Vector3(0, 0, 1));
  const uAlt: any = uniform(h);

  const stage = atmosphere.binding.lighting({
    directShadow: (context: any) => {
      const up: any = normalize(context.sphereNormal);
      const mu: any = dot(up, uSun);
      const t: any = sqrt(mu.mul(mu).mul(R * R).add(uAlt.mul(2 * R)).add(uAlt.mul(uAlt))).sub(mu.mul(R));
      const crossing: any = up.mul(R).add(uSun.mul(t));
      return float(1).sub(shell.coverageAt(crossing).mul(uStrength).mul(0.85));
    },
  });
  surface.setLightingStage({ id: 'atmosphere', stage });

  return {
    setStrength(strength: number): void {
      uStrength.value = strength;
    },
    setAltitude(altitudeUnits: number): void {
      uAlt.value = altitudeUnits;
    },
    update(): void {
      // The shadow reads the sun the clouds are lit with, so the two cannot disagree.
      (uSun.value as Vector3).copy(shell.sunDirection).normalize();
    },
    dispose(): void {
      surface.setLightingStage(null);
    },
  };
}
