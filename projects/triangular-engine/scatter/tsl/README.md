# triangular-engine/scatter/tsl

TSL (`WebGPURenderer` node) twins of the scatter density field in
`triangular-engine/scatter`. A surface material uses them to draw the far form
of a scatter layer (canopy, rock speckle) from the same field the CPU places
instances from, so the instances and the far form agree.

This entry imports `three/tsl`. It is kept apart from `triangular-engine/scatter`
so WebGL-only consumers of scatter never pull in the WebGPU build.

```ts
import { evaluateScatterDensityField, type IScatterDensityFieldDefinition } from 'triangular-engine/scatter';
import { scatterDensityFieldNode } from 'triangular-engine/scatter/tsl';

const forest: IScatterDensityFieldDefinition = {
  octaves: [
    { cellM: 6000, weight: 0.55 },
    { cellM: 1500, weight: 0.3 },
    { cellM: 120, weight: 0.15 },
  ],
  edge: [0.45, 0.62],
  heightBandM: { rise: [5, 40], fall: [1800, 2600] },
};

// CPU, for placement (worker):
const d = evaluateScatterDensityField(forest, x, y, z, heightM);

// GPU, inside a surface layer; `p` is a vec3 node of body-fixed metres:
const density = scatterDensityFieldNode(forest, p, heightNode);
```

| Node | CPU twin |
| --- | --- |
| `scatterDensityFieldNode(definition, p, heightM)` | `evaluateScatterDensityField` |
| `scatterDensityNoiseNode(definition, p)` | `evaluateScatterDensityNoise` |
| `scatterHeightBandNode(band, heightM)` | `evaluateScatterHeightBand` |
| `scatterValueNoiseNode(p, cellM, octave)` | `scatterValueNoise3` |
| `scatterLatticeHashNode(ix, iy, iz)` | `hashScatterLattice01` |

The definition is baked into the node graph; a changed definition needs a new
node (and a material recompile). `scatter-density-field-node.spec.ts` evaluates
the nodes on the GPU in headless Chrome and holds them within 0.01 of the CPU at
planet scale (600 km), where float32 carries a few centimetres of error.

Positions must be body-fixed (planet-centred, not camera-relative), or the
field moves with the camera. See the [scatter guide](../README.md#planet-scatter).
