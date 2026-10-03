import { DecimalPipe, TitleCasePipe, UpperCasePipe } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  signal,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { Vector3Tuple } from 'three';
import {
  CsmAdaptiveRange,
  CsmSplitMode,
  EngineModule,
  EngineService,
} from 'triangular-engine';

export type ShadowMode = 'csm' | 'standard' | 'off';

interface LandmarkObject {
  position: Vector3Tuple;
  scale: Vector3Tuple;
  color: string;
}

@Component({
  selector: 'app-csm-lab-page',
  standalone: true,
  imports: [RouterLink, EngineModule, DecimalPipe, UpperCasePipe],
  templateUrl: './csm-lab-page.component.html',
  styleUrl: './csm-lab-page.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [EngineService.provide({ showFPS: true })],
  host: { class: 'flex-page' },
})
export class CsmLabPageComponent {
  // Mode selection: Compare CSM against single-box standard directional shadows
  readonly shadowMode = signal<ShadowMode>('csm');

  // CSM Controls
  readonly cascades = signal<number>(4);
  readonly maxDistance = signal<number>(450);
  readonly splitMode = signal<CsmSplitMode>('practical');
  readonly fade = signal<boolean>(true);
  readonly shadowMapSize = signal<number>(2048);
  readonly shadowBias = signal<number>(-0.0001);
  readonly debugHelper = signal<boolean>(false);

  // Lighting Direction & Sun Angle Controls
  readonly sunAzimuth = signal<number>(45); // degrees
  readonly sunElevation = signal<number>(55); // degrees
  readonly sunIntensity = signal<number>(3.0);

  // Planetary Section Controls
  readonly viewPlanetSection = signal<boolean>(false);
  readonly adaptivePlanetRange = signal<boolean>(true);

  // Sun direction computed from azimuth & elevation
  readonly lightDirection = computed<Vector3Tuple>(() => {
    const azRad = (this.sunAzimuth() * Math.PI) / 180;
    const elRad = (this.sunElevation() * Math.PI) / 180;
    const x = -Math.cos(elRad) * Math.sin(azRad);
    const y = -Math.sin(elRad);
    const z = -Math.cos(elRad) * Math.cos(azRad);
    return [x, y, z];
  });

  // Standard shadow light position (matches sun direction vector placed up-sun)
  readonly standardLightPosition = computed<Vector3Tuple>(() => {
    const dir = this.lightDirection();
    return [-dir[0] * 120, -dir[1] * 120, -dir[2] * 120];
  });

  // Adaptive range configuration for spherical planet
  readonly planetAdaptiveConfig: CsmAdaptiveRange = {
    center: [0, 0, -350],
    surfaceRadius: 100,
    minDistance: 50,
    maxDistance: 600,
    altitudeScale: 1.5,
    fadeOutAltitude: 250,
    maxFadeAltitude: 550,
  };

  // Scene props / landscape objects positioned at varying distances (0m to 400m)
  readonly fieldObjects: LandmarkObject[] = this.generateFieldObjects();

  private generateFieldObjects(): LandmarkObject[] {
    const objects: LandmarkObject[] = [];

    // Dense foreground details (0m to 25m) around the center origin
    const fgColors = ['#e65100', '#f57c00', '#ffb74d', '#2e7d32', '#388e3c'];
    for (let i = 0; i < 20; i++) {
      const angle = (i / 20) * Math.PI * 2;
      const radius = 2.5 + (i % 5) * 3.5;
      const x = Math.cos(angle) * radius;
      const z = Math.sin(angle) * radius;
      const height = 1.0 + (i % 4) * 0.8;
      const width = 0.35 + (i % 3) * 0.2;
      objects.push({
        position: [x, height / 2, z],
        scale: [width, height, width],
        color: fgColors[i % fgColors.length],
      });
    }

    // Midground avenue of monoliths / pillars (30m to 150m)
    const midColors = ['#00838f', '#0097a7', '#00acc1', '#0288d1', '#039be5'];
    for (let dist = 30; dist <= 160; dist += 18) {
      // Left and right avenue columns
      const leftHeight = 6 + (dist % 5) * 1.5;
      const rightHeight = 5 + (dist % 7) * 1.8;
      const colIdx = Math.floor(dist / 18);
      objects.push({
        position: [-15 - (dist * 0.05), leftHeight / 2, -dist],
        scale: [2.0, leftHeight, 2.0],
        color: midColors[colIdx % midColors.length],
      });
      objects.push({
        position: [15 + (dist * 0.05), rightHeight / 2, -dist],
        scale: [2.0, rightHeight, 2.0],
        color: midColors[(colIdx + 1) % midColors.length],
      });
    }

    // Distant mountain spires and towers (180m to 380m)
    const farColors = ['#455a64', '#546e7a', '#607d8b', '#78909c'];
    for (let dist = 180; dist <= 380; dist += 35) {
      const colIdx = Math.floor(dist / 35);
      for (const side of [-1, 1]) {
        const xOffset = side * (40 + (dist * 0.25));
        const spireHeight = 25 + (dist * 0.12);
        const spireWidth = 8 + (dist * 0.03);
        objects.push({
          position: [xOffset, spireHeight / 2, -dist],
          scale: [spireWidth, spireHeight, spireWidth],
          color: farColors[colIdx % farColors.length],
        });
      }
    }

    return objects;
  }

  setShadowMode(mode: ShadowMode): void {
    this.shadowMode.set(mode);
  }

  toggleDebugHelper(): void {
    this.debugHelper.update((v) => !v);
  }

  toggleFade(): void {
    this.fade.update((v) => !v);
  }

  togglePlanetView(): void {
    this.viewPlanetSection.update((v) => !v);
  }
}
