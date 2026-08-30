import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  inject,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { RouterLink } from '@angular/router';
import { Color, MeshStandardMaterial } from 'three';
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
  createFlowRibbon,
  createProceduralRiver,
  createWaterFlowMaterial,
  RiverCarvedTerrainField,
} from 'triangular-engine/worldgen/render';

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
  private readonly waterMaterial = createWaterFlowMaterial();
  private readonly waterMesh = createFlowRibbon(
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
