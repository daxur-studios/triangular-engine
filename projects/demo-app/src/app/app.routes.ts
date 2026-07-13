import { Routes } from '@angular/router';

export const routes: Routes = [
  {
    path: '',
    pathMatch: 'full',
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
];
