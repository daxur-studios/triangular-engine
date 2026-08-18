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
    path: 'cdlod-planet-lab',
    loadComponent: () =>
      import('./pages/cdlod-planet-lab/cdlod-planet-lab-page.component').then(
        ({ CdlodPlanetLabPageComponent }) => CdlodPlanetLabPageComponent,
      ),
  },
  {
    path: 'navigation-lab',
    loadComponent: () =>
      import('./pages/navigation-lab/navigation-lab-page.component').then(
        ({ NavigationLabPageComponent }) => NavigationLabPageComponent,
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
      import('./pages/water-buoyancy-poc/water-buoyancy-poc-page.component').then(
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
      import('./pages/scatter-physics-lab/scatter-physics-lab-page.component').then(
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
    path: 'flora-lab',
    loadComponent: () =>
      import('./pages/flora-lab/flora-lab-page.component').then(
        ({ FloraLabPageComponent }) => FloraLabPageComponent,
      ),
  },
  {
    path: 'flora-scatter-lab',
    canActivate: [
      () =>
        import('triangular-engine/jolt').then(({ JoltPhysicsService }) =>
          JoltPhysicsService.load().then(() => true),
        ),
    ],
    loadComponent: () =>
      import('./pages/flora-scatter-lab/flora-scatter-lab-page.component').then(
        ({ FloraScatterLabPageComponent }) => FloraScatterLabPageComponent,
      ),
  },
  {
    path: 'flora-affordance-lab',
    loadComponent: () =>
      import('./pages/flora-affordance-lab/flora-affordance-lab-page.component').then(
        ({ FloraAffordanceLabPageComponent }) => FloraAffordanceLabPageComponent,
      ),
  },
  {
    path: 'meadow-lab',
    loadComponent: () =>
      import('./pages/meadow-lab/meadow-lab-page.component').then(
        ({ MeadowLabPageComponent }) => MeadowLabPageComponent,
      ),
  },
  {
    path: 'animals-lab',
    loadComponent: () =>
      import('./pages/animals-lab/animals-lab-page.component').then(
        ({ AnimalsLabPageComponent }) => AnimalsLabPageComponent,
      ),
  },
  {
    path: 'animals-worlds-lab',
    loadComponent: () =>
      import('./pages/animals-worlds-lab/animals-worlds-lab-page.component').then(
        ({ AnimalsWorldsLabPageComponent }) => AnimalsWorldsLabPageComponent,
      ),
  },
    {
      path: 'animals-terrain-world-lab',
      loadComponent: () => import('./pages/animals-terrain-world-lab/animals-terrain-world-lab-page.component').then(({ AnimalsTerrainWorldLabPageComponent }) => AnimalsTerrainWorldLabPageComponent),
    },
    {
      path: 'animals-herd-worlds-lab',
    loadComponent: () =>
      import('./pages/animals-herd-worlds-lab/animals-herd-worlds-lab-page.component').then(
        ({ AnimalsHerdWorldsLabPageComponent }) => AnimalsHerdWorldsLabPageComponent,
      ),
  },
  {
    path: 'animals-fish-worlds-lab',
    loadComponent: () =>
      import('./pages/animals-fish-worlds-lab/animals-fish-worlds-lab-page.component').then(
        ({ AnimalsFishWorldsLabPageComponent }) => AnimalsFishWorldsLabPageComponent,
      ),
  },

  {
    path: 'terrain-composer-lab',
    loadComponent: () =>
      import('./pages/terrain-composer-lab/terrain-composer-lab-page.component').then(
        ({ TerrainComposerLabPageComponent }) =>
          TerrainComposerLabPageComponent,
      ),
  },
  {
    path: 'geological-features-lab',
    loadComponent: () =>
      import('./pages/geological-features/geological-features-page.component').then(
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
      import('./pages/vehicle-trail-lab/vehicle-trail-lab-page.component').then(
        ({ VehicleTrailLabPageComponent }) => VehicleTrailLabPageComponent,
      ),
  },
  {
    path: 'soft-bend-constraint',
    canActivate: [
      () =>
        import('triangular-engine/jolt').then(({ JoltPhysicsService }) =>
          JoltPhysicsService.load().then(() => true),
        ),
    ],
    loadComponent: () => import('./pages/soft-bend-constraint/soft-bend-constraint-page.component').then(
      (m) => m.SoftBendConstraintPageComponent,
    ),
  },
  {
    path: 'destruction-poc',
    canActivate: [
      () =>
        import('triangular-engine/jolt').then(({ JoltPhysicsService }) =>
          JoltPhysicsService.load().then(() => true),
        ),
    ],
    loadComponent: () =>
      import('./pages/destruction-poc/destruction-poc-page.component').then(
        ({ DestructionPocPageComponent }) => DestructionPocPageComponent,
      ),
  },
  {
    path: 'soft-body-poc',
    canActivate: [
      () =>
        import('triangular-engine/jolt').then(({ JoltPhysicsService }) =>
          JoltPhysicsService.load().then(() => true),
        ),
    ],
    loadComponent: () =>
      import('./pages/soft-body-poc/soft-body-poc-page.component').then(
        ({ SoftBodyPocPageComponent }) => SoftBodyPocPageComponent,
      ),
  },
  {
    path: 'soft-body-tear-lab',
    canActivate: [
      () =>
        import('triangular-engine/jolt').then(({ JoltPhysicsService }) =>
          JoltPhysicsService.load().then(() => true),
        ),
    ],
    loadComponent: () =>
      import('./pages/soft-body-tear-lab/soft-body-tear-lab-page.component').then(
        ({ SoftBodyTearLabPageComponent }) => SoftBodyTearLabPageComponent,
      ),
  },
  {
    path: 'parts-lab',
    canActivate: [
      () =>
        import('triangular-engine/jolt').then(({ JoltPhysicsService }) =>
          JoltPhysicsService.load().then(() => true),
        ),
    ],
    loadComponent: () =>
      import('./pages/parts-lab/parts-lab-page.component').then(
        ({ PartsLabPageComponent }) => PartsLabPageComponent,
      ),
  },
];

