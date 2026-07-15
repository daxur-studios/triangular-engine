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
];
