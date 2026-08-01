import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  inject,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { RouterLink } from '@angular/router';
import {
  BufferAttribute,
  BufferGeometry,
  Color,
  DoubleSide,
  Mesh,
  MeshStandardMaterial,
  ShaderMaterial,
} from 'three';
import { EngineModule, EngineService } from 'triangular-engine';
import {
  PlaneTerrainDomain,
  TerrainSurfaceComponent,
  type IPlaneTerrainPatchAddress,
  type ITerrainField,
  type ITerrainFieldSample,
  type ITerrainSurfaceColorContext,
  type TerrainVector3,
} from 'triangular-engine/terrain';
import {
  WATER_LOGDEPTH_FRAGMENT_GLSL,
  WATER_LOGDEPTH_PARS_FRAGMENT_GLSL,
  WATER_LOGDEPTH_PARS_VERTEX_GLSL,
  WATER_LOGDEPTH_VERTEX_GLSL,
} from 'triangular-engine/water';
import {
  createProceduralRiver,
  RiverCarvedTerrainField,
  type RiverPath,
} from './river-system';

class RiverValleyField implements ITerrainField {
  readonly minElevationM = -8;
  readonly maxElevationM = 55;

  sample([x, _y, z]: TerrainVector3): ITerrainFieldSample {
    const broadValley = Math.min(24, Math.abs(x) * 0.055);
    const rolling =
      Math.sin(x * 0.018 + z * 0.006) * 4 +
      Math.sin(z * 0.025 - x * 0.009) * 2.5;
    const downstreamSlope = 34 - ((z + 512) / 1024) * 25;
    return { elevationM: downstreamSlope + broadValley + rolling };
  }

  sampleBatch(
    positions: Float64Array,
    elevations = new Float64Array(positions.length / 3),
  ): Float64Array {
    for (let index = 0; index < elevations.length; index++) {
      elevations[index] = this.sample([
        positions[index * 3],
        positions[index * 3 + 1],
        positions[index * 3 + 2],
      ]).elevationM;
    }
    return elevations;
  }
}

@Component({
  selector: 'app-river-lab-page',
  imports: [RouterLink, EngineModule, TerrainSurfaceComponent],
  templateUrl: './river-lab-page.component.html',
  styleUrl: './river-lab-page.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [
    EngineService.provide({
      showFPS: true,
      webGLRendererParameters: { logarithmicDepthBuffer: true },
    }),
  ],
  host: { class: 'flex-page' },
})
export class RiverLabPageComponent {
  readonly river = createProceduralRiver();
  readonly field = new RiverCarvedTerrainField(
    new RiverValleyField(),
    this.river,
    3.5,
    2.1,
  );
  readonly domain = new PlaneTerrainDomain(512);
  readonly roots: readonly IPlaneTerrainPatchAddress[] = [
    { level: 0, x: -1, z: -1 },
    { level: 0, x: 0, z: -1 },
    { level: 0, x: -1, z: 0 },
    { level: 0, x: 0, z: 0 },
  ];
  readonly wireframe = signal(false);
  readonly pointCount = this.river.points.length;
  readonly createTerrainMaterial = () =>
    new MeshStandardMaterial({
      color: '#ffffff',
      roughness: 0.96,
      vertexColors: true,
    });
  readonly createTerrainColors = (
    context: ITerrainSurfaceColorContext<IPlaneTerrainPatchAddress>,
  ): Float32Array => this.createColors(context);

  private readonly engine = inject(EngineService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly waterMaterial = createFlowMaterial();
  private readonly waterMesh = createRiverRibbon(
    this.river,
    this.waterMaterial,
  );

  constructor() {
    this.engine.scene.add(this.waterMesh);
    this.engine.elapsedTime$
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((elapsedTime) => {
        this.waterMaterial.uniforms['time'].value = elapsedTime;
      });
    this.destroyRef.onDestroy(() => {
      this.waterMesh.removeFromParent();
      this.waterMesh.geometry.dispose();
      this.waterMaterial.dispose();
    });
  }

  toggleWireframe(): void {
    this.wireframe.update((value) => !value);
  }

  private createColors(
    context: ITerrainSurfaceColorContext<IPlaneTerrainPatchAddress>,
  ): Float32Array {
    const positions = context.surface.positions;
    const colors = new Float32Array(positions.length);
    const grass = new Color('#587447');
    const bank = new Color('#8a744f');
    const rock = new Color('#77736a');
    const color = new Color();
    for (let offset = 0; offset < positions.length; offset += 3) {
      const x = context.centerWorldM[0] + positions[offset];
      const y = context.centerWorldM[1] + positions[offset + 1];
      const z = context.centerWorldM[2] + positions[offset + 2];
      const river = this.river.sample(x, z);
      const bankMix = Math.max(0, 1 - river.distance / (river.halfWidth * 3.2));
      color.copy(grass).lerp(bank, bankMix * 0.78);
      if (y > 43) color.lerp(rock, Math.min(1, (y - 43) / 15));
      colors[offset] = color.r;
      colors[offset + 1] = color.g;
      colors[offset + 2] = color.b;
    }
    return colors;
  }
}

function createRiverRibbon(river: RiverPath, material: ShaderMaterial): Mesh {
  const count = river.points.length;
  const positions = new Float32Array(count * 2 * 3);
  const uvs = new Float32Array(count * 2 * 2);
  const indices: number[] = [];
  for (let index = 0; index < count; index++) {
    const point = river.points[index];
    const previous = river.points[Math.max(0, index - 1)];
    const next = river.points[Math.min(count - 1, index + 1)];
    const dx = next.x - previous.x;
    const dz = next.z - previous.z;
    const inverseLength = 1 / Math.hypot(dx, dz);
    const perpendicularX = -dz * inverseLength;
    const perpendicularZ = dx * inverseLength;
    for (let side = 0; side < 2; side++) {
      const sign = side === 0 ? -1 : 1;
      const vertex = index * 2 + side;
      positions[vertex * 3] = point.x + perpendicularX * point.halfWidth * sign;
      positions[vertex * 3 + 1] = point.surfaceY + 0.08;
      positions[vertex * 3 + 2] =
        point.z + perpendicularZ * point.halfWidth * sign;
      uvs[vertex * 2] = side;
      uvs[vertex * 2 + 1] = index / (count - 1);
    }
    if (index < count - 1) {
      const start = index * 2;
      indices.push(
        start,
        start + 2,
        start + 1,
        start + 1,
        start + 2,
        start + 3,
      );
    }
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  const mesh = new Mesh(geometry, material);
  mesh.renderOrder = 1;
  return mesh;
}

function createFlowMaterial(): ShaderMaterial {
  return new ShaderMaterial({
    uniforms: { time: { value: 0 } },
    vertexShader: `
      ${WATER_LOGDEPTH_PARS_VERTEX_GLSL}
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        ${WATER_LOGDEPTH_VERTEX_GLSL}
      }
    `,
    fragmentShader: `
      ${WATER_LOGDEPTH_PARS_FRAGMENT_GLSL}
      uniform float time;
      varying vec2 vUv;
      void main() {
        float travelling = sin((vUv.y * 150.0 - time * 7.0) + sin(vUv.x * 11.0));
        float crossRipple = sin(vUv.x * 28.0 + time * 1.8) * 0.5 + 0.5;
        float foam = smoothstep(0.82, 1.0, travelling * 0.5 + 0.5) * crossRipple;
        float edge = smoothstep(0.0, 0.16, vUv.x) * smoothstep(0.0, 0.16, 1.0 - vUv.x);
        vec3 deep = vec3(0.025, 0.24, 0.31);
        vec3 crest = vec3(0.38, 0.78, 0.78);
        gl_FragColor = vec4(mix(deep, crest, foam * 0.65), 0.83 * edge);
        ${WATER_LOGDEPTH_FRAGMENT_GLSL}
      }
    `,
    transparent: true,
    depthWrite: false,
    side: DoubleSide,
  });
}
