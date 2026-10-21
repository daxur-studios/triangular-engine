import { MeshBasicNodeMaterial } from 'three/webgpu';
import { createPlanetMorphUniforms } from './planet-morph-nodes';
import { planetBorderMaterial, planetMapBorderMaterial } from './planet-line-materials';
import { meshOf, renderRgba, triangleWith } from './render-eval.testing';

const W = 128;
const H = 64;
const VIEW = { left: -Math.PI, right: Math.PI, top: Math.PI / 2, bottom: -Math.PI / 2 };
/** Map-space (lon, lat) to pixel, for the equirectangular map of width 2 pi and height pi. */
const pixelAt = (lon: number, lat: number): [number, number] => [
  Math.round(((lon + Math.PI) / (2 * Math.PI)) * W),
  Math.round(((Math.PI / 2 - lat) / Math.PI) * H),
];
const dirAt = (lon: number, lat: number): number[] => [
  Math.cos(lat) * Math.sin(lon),
  Math.sin(lat),
  Math.cos(lat) * Math.cos(lon),
];

function dynamicUniforms(morph: number) {
  const uniforms = createPlanetMorphUniforms();
  uniforms.uMorph.value = morph;
  uniforms.uProjMode.value = 1;
  uniforms.uProjectionType.value = 0; // equirectangular
  uniforms.uMapWidth.value = 2 * Math.PI;
  uniforms.uMapHeight.value = Math.PI;
  uniforms.uRadius.value = 1;
  return uniforms;
}

describe('planetBorderMaterial on the GPU', () => {
  /** A ribbon triangle at `corners`; every vertex's `aOtherDir` is the segment's far end `other`. */
  function ribbon(corners: [number, number][], other: [number, number], onSphere = false) {
    const flat = corners.map(([lon, lat]) => [lon, lat, 0]);
    // The bent morph needs real sphere points; the default keeps them on the flat map (a unit globe is bent at morph < 1).
    const sphere = onSphere ? corners.map(([lon, lat]) => dirAt(lon, lat)) : flat;
    return triangleWith({
      position: { itemSize: 3, values: sphere },
      aSpherePos: { itemSize: 3, values: sphere },
      aFlatPos: { itemSize: 3, values: flat },
      aSphereNorm: { itemSize: 3, values: corners.map(([lon, lat]) => dirAt(lon, lat)) },
      aOtherDir: { itemSize: 3, values: corners.map(() => dirAt(other[0], other[1])) },
      uv: { itemSize: 2, values: [[0, 0], [1, 0], [0.5, 1]] },
    });
  }
  const draw = async (morph: number, corners: [number, number][], other: [number, number], onSphere = false) => {
    const { material } = planetBorderMaterial(dynamicUniforms(morph), { opacity: 0.6, ribbonWidth: 0.01 });
    const read = await renderRgba([meshOf(ribbon(corners, other, onSphere), material)], VIEW);
    // The bent morph shifts a sphere-space triangle by a few pixels, so look for the ribbon instead of one pixel.
    if (onSphere) {
      let peak = 0;
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) peak = Math.max(peak, read(x, y)[3]);
      return peak;
    }
    const points = onSphere ? corners.map(([lon, lat]) => dirAt(lon, lat)) : corners.map(([lon, lat]) => [lon, lat]);
    const cx = points.reduce((s, c) => s + c[0], 0) / 3;
    const cy = points.reduce((s, c) => s + c[1], 0) / 3;
    return read(...pixelAt(cx, cy))[3];
  };

  // Near the antimeridian: from lon pi - 0.1 to lon -pi + 0.1 crosses the cut.
  const nearSeam: [number, number][] = [[Math.PI - 0.15, -0.1], [Math.PI - 0.05, -0.1], [Math.PI - 0.1, -0.5]];
  const acrossSeam: [number, number] = [-Math.PI + 0.1, -0.3];
  const mid: [number, number][] = [[0, 0.2], [0.6, 0.2], [0.3, 0.7]];
  const midOther: [number, number] = [0.9, 0.4];

  it('draws an edge that stays on one side of the seam', async () => {
    expect(await draw(1, mid, midOther)).toBeCloseTo(0.6, 2);
  });

  it('discards an edge that crosses the antimeridian while morphing', async () => {
    expect(await draw(1, nearSeam, acrossSeam)).toBe(0);
  });

  it('keeps that edge when the morph is at or below 0.05 (the check can fail)', async () => {
    expect(await draw(0.04, nearSeam, acrossSeam, true)).toBeCloseTo(0.6, 2);
  });

  it('uses plain line materials for ribbon width 0 and mesh materials above it', () => {
    const uniforms = dynamicUniforms(1);
    expect(planetBorderMaterial(uniforms).material.type).toBe('LineBasicNodeMaterial');
    expect(planetBorderMaterial(uniforms, { ribbonWidth: 1 }).material.type).toBe('MeshBasicNodeMaterial');
    expect(planetBorderMaterial(uniforms, { ribbonWidth: 1 }).vertexAttributes).toContain('uv');
  });
});

describe('planetMapBorderMaterial on the GPU', () => {
  const big = [[-3, -1.5, 0], [3, -1.5, 0], [0, 1.5, 0]];
  function frame(uvY: number, tick = 0) {
    return triangleWith({
      position: { itemSize: 3, values: big },
      aSpherePos: { itemSize: 3, values: big },
      aFlatPos: { itemSize: 3, values: big },
      aSphereNorm: { itemSize: 3, values: [[0, 0, 1], [0, 0, 1], [0, 0, 1]] },
      aTick: { itemSize: 1, values: [[tick], [tick], [tick]] },
      uv: { itemSize: 2, values: [[0.5, uvY], [0.5, uvY], [0.5, uvY]] },
    });
  }
  const alphaAt = async (morph: number, style: 'simple' | 'cartographic' | 'tactical', uvY = 0.5, tick = 0) => {
    const border = planetMapBorderMaterial(dynamicUniforms(morph), { opacity: 0.85, borderStyle: style });
    const read = await renderRgba([meshOf(frame(uvY, tick), border.material)], VIEW);
    return read(W / 2, H / 2)[3];
  };

  it('is hidden below the fade-out morph and fades in linearly to the fade-start morph', async () => {
    expect(await alphaAt(0.3, 'simple')).toBe(0);
    expect(await alphaAt(0.5, 'simple')).toBeCloseTo(0.85 * 0.5, 2);
    expect(await alphaAt(1, 'simple')).toBeCloseTo(0.85, 2);
  });

  it('dims the cartographic frame away from its neatlines and keeps it on them', async () => {
    expect(await alphaAt(1, 'cartographic', 0.5)).toBeCloseTo(0.85 * 0.45, 2);
    expect(await alphaAt(1, 'cartographic', 0.15)).toBeCloseTo(0.85, 2);
  });

  it('dims the tactical frame inside and lights its outer edge and ticks', async () => {
    expect(await alphaAt(1, 'tactical', 0.5)).toBeCloseTo(0.85 * 0.3, 2);
    expect(await alphaAt(1, 'tactical', 1)).toBeCloseTo(0.85, 2);
    expect(await alphaAt(1, 'tactical', 0.5, 1)).toBeCloseTo(0.85, 2);
  });

  it('switches style through a uniform without recompiling', () => {
    const border = planetMapBorderMaterial(dynamicUniforms(1));
    const material = border.material as MeshBasicNodeMaterial;
    const version = material.version;
    border.style.value = 2;
    expect(material.version).toBe(version);
  });
});
