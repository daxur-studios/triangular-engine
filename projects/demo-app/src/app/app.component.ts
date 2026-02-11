import { CommonModule } from '@angular/common';
import { Component, inject, signal } from '@angular/core';
import { RouterModule } from '@angular/router';
import { RigidBodyType } from '@dimforge/rapier3d-compat';
import { DoubleSide, MathUtils } from 'three';

import { EngineModule, EngineService, EngineTextures } from 'triangular-engine';

@Component({
  selector: 'app-root',
  imports: [RouterModule, CommonModule, EngineModule],
  templateUrl: './app.component.html',
  styleUrl: './app.component.scss',
  providers: [
    EngineService.provide({
      showFPS: true,
    }),
  ],
  host: {
    class: 'flex-page',
  },
})
export class AppComponent {
  readonly engineService = inject(EngineService);

  readonly DoubleSide = DoubleSide;
  readonly RigidBodyType = RigidBodyType;
  readonly EngineTextures = EngineTextures;

  readonly x = MathUtils.degToRad(90);
  readonly y = MathUtils.degToRad(180);

  /** Toggle for glitch pass "go wild" mode (stronger effect). */
  readonly glitchWild = signal(false);
}
