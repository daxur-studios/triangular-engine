import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import {
  AmbientLight,
  BoxGeometry,
  Color,
  DirectionalLight,
  Mesh,
  MeshStandardMaterial,
  SphereGeometry,
  TorusGeometry,
} from 'three';
import { EngineModule, EngineService } from 'triangular-engine';

@Component({
  selector: 'app-multi-viewport-lab-page',
  imports: [RouterLink, EngineModule],
  templateUrl: './multi-viewport-lab-page.component.html',
  styleUrl: './multi-viewport-lab-page.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [EngineService.provide({ showFPS: true })],
  host: { class: 'flex-page' },
})
export class MultiViewportLabPageComponent {
  private readonly engine = inject(EngineService);

  readonly splitMode = signal<'off' | 'side-by-side' | 'quadrants'>('side-by-side');

  constructor() {
    const previousBackground = this.engine.scene.background;
    this.engine.scene.background = new Color('#0a0e27');

    // Lights
    const ambientLight = new AmbientLight('#ffffff', 0.5);
    const directionalLight = new DirectionalLight('#ffffff', 0.8);
    directionalLight.position.set(10, 15, 10);
    directionalLight.castShadow = true;
    directionalLight.shadow.mapSize.setScalar(2048);

    this.engine.scene.add(ambientLight, directionalLight);

    // Objects: rotating cube, sphere, torus
    const cube = new Mesh(
      new BoxGeometry(2, 2, 2),
      new MeshStandardMaterial({ color: '#ff6b6b', roughness: 0.4 }),
    );
    cube.position.set(-3, 0, 0);
    cube.castShadow = true;

    const sphere = new Mesh(
      new SphereGeometry(1.5, 32, 32),
      new MeshStandardMaterial({ color: '#4ecdc4', roughness: 0.3 }),
    );
    sphere.position.set(3, 0, 0);
    sphere.castShadow = true;

    const torus = new Mesh(
      new TorusGeometry(2, 0.6, 16, 100),
      new MeshStandardMaterial({ color: '#ffa500', roughness: 0.5 }),
    );
    torus.position.set(0, 2, -3);
    torus.castShadow = true;

    // Ground
    const ground = new Mesh(
      new BoxGeometry(20, 0.2, 20),
      new MeshStandardMaterial({ color: '#2c3e50', roughness: 0.8 }),
    );
    ground.position.y = -2;
    ground.receiveShadow = true;

    this.engine.scene.add(cube, sphere, torus, ground);

    // Animate objects
    this.engine.tick$.subscribe(() => {
      cube.rotation.x += 0.005;
      cube.rotation.y += 0.008;
      sphere.rotation.y += 0.003;
      torus.rotation.x += 0.004;
      torus.rotation.z += 0.006;
    });

    // Cleanup
    this.engine.onDestroy$.subscribe(() => {
      this.engine.scene.background = previousBackground;
    });
  }

  toggleSplitMode(): void {
    const modes = ['off', 'side-by-side', 'quadrants'] as const;
    const current = modes.indexOf(this.splitMode());
    this.splitMode.set(modes[(current + 1) % modes.length]);
  }

  getModeLabel(): string {
    const labels = {
      off: 'Single View',
      'side-by-side': 'Side-by-Side (2 views)',
      quadrants: '4-Way Split',
    };
    return labels[this.splitMode()];
  }
}
