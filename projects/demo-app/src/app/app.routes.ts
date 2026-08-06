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
    path: 'impostor-baker',
    loadComponent: () =>
      import('./pages/impostor-baker/impostor-baker-page.component').then(
        ({ ImpostorBakerPageComponent }) => ImpostorBakerPageComponent,
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
    canActivate: [
      () =>
        import('triangular-engine/jolt').then(({ JoltPhysicsService }) =>
          JoltPhysicsService.load().then(() => true),
        ),
    ],
    loadComponent: () =>
      import('./pages/terrain-lab/terrain-lab-page.component').then(
        ({ TerrainLabPageComponent }) => TerrainLabPageComponent,
      ),
  },
  {
    path: 'river-lab',
    loadComponent: () =>
      import('./pages/river-lab/river-lab-page.component').then(
        ({ RiverLabPageComponent }) => RiverLabPageComponent,
      ),
  },
  {
    path: 'water',
    loadComponent: () =>
      import('./pages/water/water-page.component').then(
        ({ WaterPageComponent }) => WaterPageComponent,
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
  {
    path: 'water-material-poc',
    loadComponent: () =>
      import('./pages/water-material-poc/water-material-poc-page.component').then(
        ({ WaterMaterialPocPageComponent }) => WaterMaterialPocPageComponent,
      ),
  },
  {
    path: 'water-sphere-poc',
    loadComponent: () =>
      import('./pages/water-sphere-poc/water-sphere-poc-page.component').then(
        ({ WaterSpherePocPageComponent }) => WaterSpherePocPageComponent,
      ),
  },
  {
    path: 'water-cylinder-poc',
    loadComponent: () =>
      import('./pages/water-cylinder-poc/water-cylinder-poc-page.component').then(
        ({ WaterCylinderPocPageComponent }) => WaterCylinderPocPageComponent,
      ),
  },
  {
    path: 'water-buoyancy-poc',
    canActivate: [
      () =>
        import('triangular-engine/jolt').then(({ JoltPhysicsService }) =>
          JoltPhysicsService.load().then(() => true),
        ),
    ],
    loadComponent: () =>
      import(
        './pages/water-buoyancy-poc/water-buoyancy-poc-page.component'
      ).then(
        ({ WaterBuoyancyPocPageComponent }) => WaterBuoyancyPocPageComponent,
      ),
  },
  {
    path: 'trail-lab',
    loadComponent: () =>
      import('./pages/trail-lab/trail-lab-page.component').then(
        ({ TrailLabPageComponent }) => TrailLabPageComponent,
      ),
  },
  {
    path: 'scatter-lab',
    loadComponent: () =>
      import('./pages/scatter-lab/scatter-lab-page.component').then(
        ({ ScatterLabPageComponent }) => ScatterLabPageComponent,
      ),
  },
  {
    path: 'scatter-physics-lab',
    canActivate: [
      () =>
        import('triangular-engine/jolt').then(({ JoltPhysicsService }) =>
          JoltPhysicsService.load().then(() => true),
        ),
    ],
    loadComponent: () =>
      import(
        './pages/scatter-physics-lab/scatter-physics-lab-page.component'
      ).then(
        ({ ScatterPhysicsLabPageComponent }) => ScatterPhysicsLabPageComponent,
      ),
  },
  {
    path: 'spline-lab',
    loadComponent: () =>
      import('./pages/spline-lab/spline-lab-page.component').then(
        ({ SplineLabPageComponent }) => SplineLabPageComponent,
      ),
  },
  {
    path: 'life-lab',
    loadComponent: () =>
      import('./pages/life-lab/life-lab-page.component').then(
        ({ LifeLabPageComponent }) => LifeLabPageComponent,
      ),
  },
  {
    path: 'life-lab',
    loadComponent: () =>
      import('./pages/life-lab/life-lab-page.component').then(
        ({ LifeLabPageComponent }) => LifeLabPageComponent,
      ),
  },
  {
    path: 'terrain-composer-lab',
    loadComponent: () =>
      import('./pages/terrain-composer-lab/terrain-composer-lab-page.component').then(
        ({ TerrainComposerLabPageComponent }) => TerrainComposerLabPageComponent,
      ),
  },
  {
    path: 'geological-features-lab',
    loadComponent: () =>
      import(
        './pages/geological-features/geological-features-page.component'
      ).then(
        ({ GeologicalFeaturesPageComponent }) =>
          GeologicalFeaturesPageComponent,
      ),
  },
  {
    path: 'geological-features-lab',
    loadComponent: () =>
      import(
        './pages/geological-features/geological-features-page.component'
      ).then(
        ({ GeologicalFeaturesPageComponent }) =>
          GeologicalFeaturesPageComponent,
      ),
  },
  {
    path: 'vehicle-trail-lab',
    canActivate: [
      () =>
        import('triangular-engine/jolt').then(({ JoltPhysicsService }) =>
          JoltPhysicsService.load().then(() => true),
        ),
    ],
    loadComponent: () =>
      import(
        './pages/vehicle-trail-lab/vehicle-trail-lab-page.component'
      ).then(
        ({ VehicleTrailLabPageComponent }) => VehicleTrailLabPageComponent,
      ),
  },
];
