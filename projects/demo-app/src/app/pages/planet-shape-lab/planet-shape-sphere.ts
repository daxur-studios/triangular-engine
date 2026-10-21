/* eslint-disable @typescript-eslint/no-explicit-any */
import { BufferAttribute, BufferGeometry, Sphere, SphereGeometry, Vector3 } from 'three';
import { MeshBasicNodeMaterial, MeshStandardNodeMaterial } from 'three/webgpu';
import { attribute, color, float, floor, mix, mod, positionGeometry, positionView, uniform, uv, vec2, vec4 } from 'three/tsl';
import {
  createPlanetMorphLightingUniforms, createPlanetMorphUniforms, planetMorphGraph, setPlanetMapExtent, setPlanetProjectionCentre,
  type IPlanetMorphUniforms,
} from 'triangular-engine/planet-material';

/**
 * The plain sphere, drawn camera-relative so a 6,371 km body does not jitter.
 *
 * Float32 cannot place a vertex 6.4 million metres from the origin to better than about half a metre, and the
 * subtraction of the camera position then loses the rest. So each vertex keeps its double-precision position as a high
 * float plus a low residual (`aPositionLow`), the camera is split the same way, and the vertex stage computes
 * `(high - cameraHigh) + (low - cameraLow)`. Near the camera the first difference is exact and the result is accurate
 * to well under a millimetre. The mesh sits at the origin with no rotation: the body frame IS the render frame, the
 * camera is at the origin looking along body-frame axes, and the camera position never enters the model matrix.
 */
export function createCameraRelativeSphereGeometry(radiusM: number, widthSegments: number, heightSegments: number): BufferGeometry {
  // phiStart -90° puts the UV seam at -Z, opposite the morph centre (MORPH_CENTRE), where the flat map is cut.
  const geometry = new SphereGeometry(1, widthSegments, heightSegments, -Math.PI / 2);
  const unit = geometry.getAttribute('position') as BufferAttribute;
  const high = new Float32Array(unit.count * 3);
  const low = new Float32Array(unit.count * 3);
  for (let i = 0; i < unit.count; i++) {
    // The unit vertices are float32, so renormalise in double: the exact vertex lies on the sphere, not 0.4 m off it.
    const x = unit.array[i * 3];
    const y = unit.array[i * 3 + 1];
    const z = unit.array[i * 3 + 2];
    const scale = radiusM / Math.hypot(x, y, z);
    for (let axis = 0; axis < 3; axis++) {
      const exact = unit.array[i * 3 + axis] * scale;
      high[i * 3 + axis] = exact;
      low[i * 3 + axis] = exact - high[i * 3 + axis];
    }
  }
  geometry.setAttribute('position', new BufferAttribute(high, 3));
  geometry.setAttribute('aPositionLow', new BufferAttribute(low, 3));
  // `planetMorphGraph` declares `aFlatPos`/`aFlatNorm` and reads them only in its static projection. This lab uses the
  // dynamic basis (the flat map is projected in the shader), so they are never read for their values: zeros.
  geometry.setAttribute('aFlatPos', new BufferAttribute(new Float32Array(unit.count * 3), 3));
  geometry.setAttribute('aFlatNorm', new BufferAttribute(new Float32Array(unit.count * 3), 3));
  geometry.boundingSphere = new Sphere(new Vector3(), radiusM);
  return geometry;
}

export interface PlainSphereMaterial {
  readonly material: MeshStandardNodeMaterial;
  /**
   * The quality probe's material (`planet-shape-quality.ts`): the same vertex stage, unlit, writing the distance from the
   * camera in metres to red, the surface coordinates u/v to green/blue and 1 to alpha. Drawn only into the probe's float target, never to the screen.
   */
  readonly probeMaterial: MeshBasicNodeMaterial;
  /** Camera position in the body frame, in doubles; split into the two uniforms. */
  setCameraBodyPosition(x: number, y: number, z: number): void;
  /** The engine's morph uniforms, driven exactly as the cell planet drives them. */
  readonly morph: IPlanetMorphUniforms;
  /** Sphere (0) to flat map (1), a visual transform of the drawn surface only. Clamped to 0..1. */
  setMorph(value: number): void;
  /** The body radius the flat map is sized for (`setPlanetMapExtent`). */
  setBodyRadius(radiusM: number): void;
}

/**
 * The flat map is centred on this body-frame longitude (0 = +Z, 90 = +X). Every camera pose sits at longitude 0, so the map
 * at morph 1 faces the camera instead of being seen edge-on. The dynamic projection puts its antimeridian opposite the
 * centre (-Z), where the sphere geometry's UV seam is, so no triangle spans the cut.
 */
export const MORPH_CENTRE = { lonDeg: 0, latDeg: 0 } as const;

/** Fixed colours with a longitude/latitude checker: the checker is what shows the spin and the surface speed. */
export function createPlainSphereMaterial(): PlainSphereMaterial {
  const cameraHigh = uniform(new Vector3()) as any;
  const cameraLow = uniform(new Vector3()) as any;
  const material = new MeshStandardNodeMaterial({ roughness: 1, metalness: 0 });
  const low = attribute('aPositionLow', 'vec3') as any;
  // The engine's morph graph (default 'bend' shape, geometry position/normal are the sphere), in dynamic projection mode.
  const morph = createPlanetMorphUniforms();
  setPlanetProjectionCentre(morph, MORPH_CENTRE);
  // Lit with the sphere normal (identity turn), not the morphed one: the morphed normal is +Z over the whole flat map,
  // so at morph 1 the map is lit all alike and flips between lit and dark as the body spins. The sphere normal keeps
  // the day/night terminator where it is on the globe.
  const lighting = createPlanetMorphLightingUniforms();
  const graph = planetMorphGraph(morph, { sphereFromGeometry: true, lightingTurn: lighting.uMorphLightingTurn });
  // `graph.positionNode - positionGeometry` is the morph displacement: exactly 0 at morph 0 (the graph returns the baked
  // sphere point), so the camera-relative split above keeps its sub-millimetre placement. It is float32 once morphed,
  // which is fine for a picture and is never used for placement or physics.
  material.positionNode = (graph.positionNode as any).sub(positionGeometry).add((positionGeometry as any).sub(cameraHigh).add(low.sub(cameraLow)));
  material.normalNode = graph.normalNode;
  const probeMaterial = new MeshBasicNodeMaterial();
  probeMaterial.positionNode = material.positionNode;
  // The camera sits at the render origin, so the view-space length is the distance from the camera.
  const surface = uv() as any;
  probeMaterial.outputNode = vec4((positionView as any).length(), surface.x, surface.y, float(1));
  const cell = floor((uv() as any).mul(vec2(72, 36))) as any;
  material.colorNode = mix(color(0x4a7a52), color(0x7f9a62), mod(cell.x.add(cell.y), 2));
  return {
    material,
    probeMaterial,
    morph,
    setMorph(value): void { morph.uMorph.value = Math.min(1, Math.max(0, value)); },
    setBodyRadius(radiusM): void { setPlanetMapExtent(morph, radiusM); },
    setCameraBodyPosition(x, y, z): void {
      const hx = Math.fround(x);
      const hy = Math.fround(y);
      const hz = Math.fround(z);
      cameraHigh.value.set(hx, hy, hz);
      cameraLow.value.set(x - hx, y - hy, z - hz);
    },
  };
}
