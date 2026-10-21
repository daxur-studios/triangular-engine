import { CloudVolumeAtlasLayout } from './cloud-volume-atlas';

export interface MeshSdfOptions {
  /** Texels of distance kept either side of the surface. Everything farther reads as fully outside or inside. Default 4. */
  bandTexels?: number;
  /** Share of each box axis left empty around the fitted mesh, so its cloud never touches the box faces. Default 0.1. */
  padding?: number;
}

export interface MeshSdf {
  /** RGBA bytes in the density atlas layout. Value 0.5 is the surface, above it outside, below it inside. */
  data: Uint8Array;
  /** Metres from the surface at which the stored value saturates (0 or 1). */
  bandMeters: number;
}

/**
 * Plan 051 Phase 5: a mesh to a band-limited signed distance field in the cloud atlas layout, on the CPU.
 *
 * The mesh is scaled uniformly to fit inside the box (centred, with padding). Distance is exact point-to-triangle distance
 * for voxels within the band of any triangle; the sign comes from counting triangle crossings along +x through each
 * voxel column, so the mesh should be closed. Only the band matters to the density ramp, so the field is never
 * propagated outward (cost scales with surface area, not volume). Tens of thousands of triangles at 64^3 take well under a second.
 */
export function bakeMeshSdf(
  positions: ArrayLike<number>,
  indices: ArrayLike<number> | null,
  texels: number,
  boxSize: readonly [number, number, number],
  options: MeshSdfOptions = {},
): MeshSdf {
  const n = texels;
  const bandTexels = options.bandTexels ?? 4;
  const padding = options.padding ?? 0.1;
  const triangleCount = indices ? Math.floor(indices.length / 3) : Math.floor(positions.length / 9);
  const vertexIndex = (t: number, k: number): number => (indices ? indices[t * 3 + k] : t * 3 + k);

  // Fit the mesh into the box, in metres with the box centred on the origin.
  const lo = [Infinity, Infinity, Infinity];
  const hi = [-Infinity, -Infinity, -Infinity];
  for (let t = 0; t < triangleCount; t++) {
    for (let k = 0; k < 3; k++) {
      const v = vertexIndex(t, k) * 3;
      for (let a = 0; a < 3; a++) {
        lo[a] = Math.min(lo[a], positions[v + a]);
        hi[a] = Math.max(hi[a], positions[v + a]);
      }
    }
  }
  let scale = Infinity;
  for (let a = 0; a < 3; a++) scale = Math.min(scale, (boxSize[a] * (1 - 2 * padding)) / Math.max(hi[a] - lo[a], 1e-9));
  const tri = new Float64Array(triangleCount * 9);
  for (let t = 0; t < triangleCount; t++) {
    for (let k = 0; k < 3; k++) {
      const v = vertexIndex(t, k) * 3;
      for (let a = 0; a < 3; a++) tri[t * 9 + k * 3 + a] = (positions[v + a] - (lo[a] + hi[a]) / 2) * scale + boxSize[a] / 2;
    }
  }

  const voxel = [boxSize[0] / n, boxSize[1] / n, boxSize[2] / n];
  const bandMeters = bandTexels * Math.max(voxel[0], voxel[1], voxel[2]);
  const distance = new Float32Array(n * n * n).fill(bandMeters);
  const at = (x: number, y: number, z: number): number => (z * n + y) * n + x;

  // Unsigned distance, band only.
  const centre = [0, 0, 0];
  for (let t = 0; t < triangleCount; t++) {
    const o = t * 9;
    const from = [0, 0, 0];
    const to = [0, 0, 0];
    for (let a = 0; a < 3; a++) {
      const min = Math.min(tri[o + a], tri[o + 3 + a], tri[o + 6 + a]) - bandMeters;
      const max = Math.max(tri[o + a], tri[o + 3 + a], tri[o + 6 + a]) + bandMeters;
      from[a] = Math.max(0, Math.floor(min / voxel[a]));
      to[a] = Math.min(n - 1, Math.ceil(max / voxel[a]));
    }
    for (let z = from[2]; z <= to[2]; z++) {
      centre[2] = (z + 0.5) * voxel[2];
      for (let y = from[1]; y <= to[1]; y++) {
        centre[1] = (y + 0.5) * voxel[1];
        for (let x = from[0]; x <= to[0]; x++) {
          centre[0] = (x + 0.5) * voxel[0];
          const d = pointTriangleDistance(centre, tri, o);
          const i = at(x, y, z);
          if (d < distance[i]) distance[i] = d;
        }
      }
    }
  }

  // Sign: crossings of each (y, z) column with the triangles, sorted along x. A tiny offset keeps columns off shared edges.
  const columns: number[][] = new Array(n * n);
  for (let t = 0; t < triangleCount; t++) {
    const o = t * 9;
    const y0 = tri[o + 1], z0 = tri[o + 2];
    const y1 = tri[o + 4], z1 = tri[o + 5];
    const y2 = tri[o + 7], z2 = tri[o + 8];
    const det = (y1 - y0) * (z2 - z0) - (y2 - y0) * (z1 - z0);
    if (Math.abs(det) < 1e-12) continue;
    const iyMin = Math.max(0, Math.floor(Math.min(y0, y1, y2) / voxel[1] - 0.5));
    const iyMax = Math.min(n - 1, Math.ceil(Math.max(y0, y1, y2) / voxel[1] - 0.5));
    const izMin = Math.max(0, Math.floor(Math.min(z0, z1, z2) / voxel[2] - 0.5));
    const izMax = Math.min(n - 1, Math.ceil(Math.max(z0, z1, z2) / voxel[2] - 0.5));
    for (let iz = izMin; iz <= izMax; iz++) {
      const pz = (iz + 0.5 + 0.000291) * voxel[2];
      for (let iy = iyMin; iy <= iyMax; iy++) {
        const py = (iy + 0.5 + 0.000137) * voxel[1];
        const u = ((py - y0) * (z2 - z0) - (y2 - y0) * (pz - z0)) / det;
        const v = ((y1 - y0) * (pz - z0) - (py - y0) * (z1 - z0)) / det;
        if (u < 0 || v < 0 || u + v > 1) continue;
        const x = tri[o] + u * (tri[o + 3] - tri[o]) + v * (tri[o + 6] - tri[o]);
        (columns[iz * n + iy] ??= []).push(x);
      }
    }
  }
  for (let z = 0; z < n; z++) {
    for (let y = 0; y < n; y++) {
      const hits = columns[z * n + y];
      if (!hits) continue;
      hits.sort((a, b) => a - b);
      let crossed = 0;
      for (let x = 0; x < n; x++) {
        const cx = (x + 0.5) * voxel[0];
        while (crossed < hits.length && hits[crossed] < cx) crossed++;
        if (crossed & 1) distance[at(x, y, z)] *= -1;
      }
    }
  }

  return { data: packAtlas(new CloudVolumeAtlasLayout(n), (x, y, z) => distance[at(x, y, z)], bandMeters), bandMeters };
}

/** Writes `value(x, y, z)` (metres, signed) into the density atlas layout as bytes: 0.5 at the surface, saturating at the band. */
function packAtlas(layout: CloudVolumeAtlasLayout, value: (x: number, y: number, z: number) => number, bandMeters: number): Uint8Array {
  const n = layout.size;
  const data = new Uint8Array(layout.width * layout.height * 4);
  for (let g = 0; g < layout.groups; g++) {
    const left = (g % layout.columns) * n;
    const top = Math.floor(g / layout.columns) * n;
    for (let k = 0; k < 4; k++) {
      const z = Math.min(g * CloudVolumeAtlasLayout.STRIDE + k, n - 1);
      for (let y = 0; y < n; y++) {
        for (let x = 0; x < n; x++) {
          const encoded = Math.max(0, Math.min(1, 0.5 + value(x, y, z) / (2 * bandMeters)));
          data[((top + y) * layout.width + left + x) * 4 + k] = Math.round(encoded * 255);
        }
      }
    }
  }
  return data;
}

/** Distance from `p` to the triangle stored at `tri[o..o+9]` (Ericson, Real-Time Collision Detection 5.1.5). */
function pointTriangleDistance(p: number[], tri: Float64Array, o: number): number {
  const ax = tri[o], ay = tri[o + 1], az = tri[o + 2];
  const abx = tri[o + 3] - ax, aby = tri[o + 4] - ay, abz = tri[o + 5] - az;
  const acx = tri[o + 6] - ax, acy = tri[o + 7] - ay, acz = tri[o + 8] - az;
  const apx = p[0] - ax, apy = p[1] - ay, apz = p[2] - az;
  const d1 = abx * apx + aby * apy + abz * apz;
  const d2 = acx * apx + acy * apy + acz * apz;
  let u: number;
  let v: number;
  if (d1 <= 0 && d2 <= 0) {
    u = 0;
    v = 0;
  } else {
    const bpx = apx - abx, bpy = apy - aby, bpz = apz - abz;
    const d3 = abx * bpx + aby * bpy + abz * bpz;
    const d4 = acx * bpx + acy * bpy + acz * bpz;
    const cpx = apx - acx, cpy = apy - acy, cpz = apz - acz;
    const d5 = abx * cpx + aby * cpy + abz * cpz;
    const d6 = acx * cpx + acy * cpy + acz * cpz;
    const vc = d1 * d4 - d3 * d2;
    const vb = d5 * d2 - d1 * d6;
    const va = d3 * d6 - d5 * d4;
    if (d3 >= 0 && d4 <= d3) {
      u = 1;
      v = 0;
    } else if (vc <= 0 && d1 >= 0 && d3 <= 0) {
      u = d1 / (d1 - d3);
      v = 0;
    } else if (d6 >= 0 && d5 <= d6) {
      u = 0;
      v = 1;
    } else if (vb <= 0 && d2 >= 0 && d6 <= 0) {
      u = 0;
      v = d2 / (d2 - d6);
    } else if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) {
      v = (d4 - d3) / (d4 - d3 + (d5 - d6));
      u = 1 - v;
    } else {
      const denom = 1 / (va + vb + vc);
      u = vb * denom;
      v = vc * denom;
    }
  }
  const dx = apx - u * abx - v * acx;
  const dy = apy - u * aby - v * acy;
  const dz = apz - u * abz - v * acz;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}
