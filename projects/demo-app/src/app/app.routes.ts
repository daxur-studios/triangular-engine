import { Routes } from '@angular/router';

export const routes: Routes = [
  {
    path: '',
    pathMatch: 'full',
    loadComponent: () =>
      import('./pages/demo-index/demo-index.component').then(
        ({ DemoIndexComponent }) => DemoIndexComponent,
      ),
  },
  {
    path: 'engine-demo',
    loadComponent: () =>
      import('./engine-demo/engine-demo.component').then(
        ({ EngineDemoComponent }) => EngineDemoComponent,
      ),
  },
  {
    path: 'camera-and-floating-origin',
    loadComponent: () =>
      import('./pages/camera-floating-origin/camera-floating-origin-page.component').then(
        ({ CameraFloatingOriginPageComponent }) =>
          CameraFloatingOriginPageComponent,
      ),
  },
  {
    path: 'takram-clouds-spike',
    loadComponent: () =>
      import('./takram-clouds-spike/takram-clouds-spike.component').then(
        ({ TakramCloudsSpikeComponent }) => TakramCloudsSpikeComponent,
      ),
  },
  {
    path: 'takram-clouds',
    loadComponent: () =>
      import('./pages/takram-clouds/takram-clouds-page.component').then(
        ({ TakramCloudsPageComponent }) => TakramCloudsPageComponent,
      ),
  },
  {
    path: 'takram-mini-planet',
    loadComponent: () =>
      import('./pages/takram-mini-planet/takram-mini-planet-page.component').then(
        ({ TakramMiniPlanetPageComponent }) => TakramMiniPlanetPageComponent,
      ),
  },
  {
    path: 'takram-cylinder-clouds',
    loadComponent: () =>
      import('./pages/takram-cylinder-clouds/takram-cylinder-clouds-page.component').then(
        ({ TakramCylinderCloudsPageComponent }) =>
          TakramCylinderCloudsPageComponent,
      ),
  },
  {
    path: 'terrain-lab',
    loadComponent: () =>
      import('./pages/terrain-lab/terrain-lab-page.component').then(
        ({ TerrainLabPageComponent }) => TerrainLabPageComponent,
      ),
  },
  {
    path: 'water-surface-spike',
    loadComponent: () =>
      import('./pages/water-surface-spike/water-surface-spike-page.component').then(
        ({ WaterSurfaceSpikePageComponent }) => WaterSurfaceSpikePageComponent,
      ),
  },
  {
    path: 'water-lod-poc',
    loadComponent: () =>
      import('./pages/water-lod-poc/water-lod-poc-page.component').then(
        ({ WaterLodPocPageComponent }) => WaterLodPocPageComponent,
      ),
  },
];
