/* eslint-disable @typescript-eslint/no-explicit-any */
import { BackSide, FrontSide, Mesh, SphereGeometry, Vector3 } from 'three';
import { NodeMaterial } from 'three/webgpu';
import {
  Break, Fn, If, Loop, cameraPosition, ceil, clamp, dot, exp, float, fract, int, length, max, min, mix, mx_fractal_noise_float,
  normalize, positionWorld, pow, screenCoordinate, select, smoothstep, sqrt, uniform, vec2, vec3, vec4,
} from 'three/tsl';

/** Options for {@link CloudNoiseShell}. */
export interface CloudNoiseShellOptions {
  /** Planet radius in metres; the planet is centred on the origin. */
  readonly planetRadius: number;
  /** Height of the shell's floor above the surface, in metres. */
  readonly baseAltitude: number;
  /** Thickness of the shell, in metres. */
  readonly thickness: number;
}

/**
 * Spike: planet-wide 3D noise clouds. One sphere mesh, one fragment-shader march through a thin spherical shell, with
 * fractal noise as the density: no per-cloud volumes, no atlas, no bake. The cost is per pixel, not per cloud.
 */
export class CloudNoiseShell {
  readonly mesh: Mesh;
  readonly coverage = uniform(0.4);
  readonly extinction = uniform(0.04);
  readonly steps = uniform(40);
  readonly frequency = uniform(1 / 2600);
  readonly drift = uniform(0.4);
  readonly time = uniform(0);
  readonly phaseFloor = uniform(0.3);
  private readonly sun = uniform(new Vector3(0, 1, 0));
  private readonly inner: number;
  private readonly outer: number;
  private readonly material: NodeMaterial;

  constructor(options: CloudNoiseShellOptions) {
    this.inner = options.planetRadius + options.baseAltitude;
    this.outer = this.inner + options.thickness;
    this.material = new NodeMaterial();
    this.material.transparent = true;
    this.material.depthWrite = false;
    // The ray is analytic and stops at the planet itself, so the proxy sphere must not be depth-tested.
    this.material.depthTest = false;
    // The march accumulates colour already weighted by coverage.
    this.material.premultipliedAlpha = true;
    this.material.side = FrontSide;
    this.material.fragmentNode = this.buildMarch();
    // Slightly oversize so the faceted proxy always covers the analytic shell's silhouette.
    this.mesh = new Mesh(new SphereGeometry(this.outer * 1.03, 96, 48), this.material);
    this.mesh.renderOrder = 20;
    this.mesh.frustumCulled = false;
  }

  /** Per frame: sun direction, drift clock, and which face of the proxy sphere to draw. */
  update(cameraPosition: Vector3, sunDirection: Vector3, seconds: number): void {
    this.sun.value.copy(sunDirection).normalize();
    this.time.value = seconds;
    this.material.side = cameraPosition.length() < this.outer * 1.03 ? BackSide : FrontSide;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    this.material.dispose();
  }

  private buildMarch(): any {
    const rInner = this.inner;
    const rOuter = this.outer;
    const thickness = rOuter - rInner;
    const density = (p: any, h: any) => {
      const q = p.mul(this.frequency).add(vec3(this.time.mul(this.drift).mul(this.frequency), 0, 0));
      const n = mx_fractal_noise_float(q, int(5), float(2.1), float(0.5)).mul(0.5).add(0.5);
      const threshold = float(1).sub(this.coverage).mul(0.55).add(0.22);
      // Rounded bottom, flatter top: a cumulus-like height profile.
      const profile = smoothstep(0.0, 0.18, h).mul(smoothstep(1.0, 0.55, h));
      return smoothstep(threshold, threshold.add(0.18), n).mul(profile);
    };
    return Fn(() => {
      const o = cameraPosition;
      const d = normalize(positionWorld.sub(cameraPosition));
      const b = dot(o, d);
      const oo = dot(o, o);
      const color = vec3(0).toVar();
      const transmittance = float(1).toVar();
      const discOuter = b.mul(b).sub(oo.sub(rOuter * rOuter));
      If(discOuter.greaterThan(0), () => {
        const root = sqrt(discOuter);
        const tStart = max(b.negate().sub(root), 0);
        const tOuterFar = b.negate().add(root);
        const discInner = b.mul(b).sub(oo.sub(rInner * rInner));
        const tInner = b.negate().sub(sqrt(max(discInner, 0)));
        const tEnd = select(discInner.greaterThan(0).and(tInner.greaterThan(tStart)), tInner, tOuterFar);
        const segment = tEnd.sub(tStart);
        const count = clamp(ceil(segment.div(60)), 6, this.steps);
        const dt = segment.div(count);
        const jitter = fract(float(52.9829189).mul(fract(dot(screenCoordinate.xy, vec2(0.06711056, 0.00583715)))));
        const cosine = dot(d, this.sun);
        const hg = (g: number) => {
          const g2 = g * g;
          return float(1 - g2).div(pow(float(1 + g2).sub(cosine.mul(2 * g)), 1.5).mul(4 * Math.PI));
        };
        const phase = max(hg(0.5).mul(0.6).add(hg(-0.3).mul(0.4)), this.phaseFloor);
        Loop(int(count), ({ i }: { i: any }) => {
          const t = tStart.add(float(i).add(jitter).mul(dt));
          const p = o.add(d.mul(t));
          const h = length(p).sub(rInner).div(thickness);
          const dens = density(p, h);
          If(dens.greaterThan(0.01), () => {
            const stepT = exp(dens.mul(this.extinction).mul(dt).negate());
            // Two taps toward the sun for self-shadowing.
            const p1 = p.add(this.sun.mul(70));
            const p2 = p.add(this.sun.mul(210));
            const h1 = length(p1).sub(rInner).div(thickness);
            const h2 = length(p2).sub(rInner).div(thickness);
            const od = density(p1, h1).mul(70).add(density(p2, h2).mul(140)).mul(this.extinction);
            const sunLight = vec3(1.0, 0.96, 0.9).mul(exp(od.negate())).mul(phase.mul(1.6));
            const up = normalize(p);
            const daylight = smoothstep(-0.15, 0.2, dot(up, this.sun));
            const ambient = mix(vec3(0.16, 0.2, 0.28), vec3(0.4, 0.48, 0.6), h);
            const lit = sunLight.mul(daylight).add(ambient.mul(daylight.mul(0.8).add(0.12)));
            color.addAssign(transmittance.mul(float(1).sub(stepT)).mul(lit));
            transmittance.mulAssign(stepT);
            If(transmittance.lessThan(0.02), () => {
              Break();
            });
          });
        });
      });
      return vec4(color, float(1).sub(transmittance));
    })();
  }
}
