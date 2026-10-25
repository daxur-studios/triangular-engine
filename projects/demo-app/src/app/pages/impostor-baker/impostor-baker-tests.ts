import type { TestScenario, TestSuite } from 'triangular-engine/testing';
import type { OctahedralImpostorType } from 'triangular-engine/impostor';
import type { TreeSpeciesKey } from './impostor-baker-page.component';

export interface ImpostorBakerTestSettings {
  readonly operation: 'check' | 'bake' | 'render' | 'compression';
  readonly species: TreeSpeciesKey;
  readonly seed: number;
  readonly type: OctahedralImpostorType;
  readonly spritesPerSide: number;
  readonly textureSizePx: number;
  readonly forestCount: number;
  readonly rebuildSourceTree: boolean;
  readonly compressionFormat: 'image/webp' | 'image/jpeg' | 'image/png';
  readonly compressionQuality: number;
  readonly normalDepthMode: 'lossless' | 'lossy';
}

const BASE: ImpostorBakerTestSettings = {
  operation: 'check',
  species: 'oak',
  seed: 7,
  type: 'hemispherical',
  spritesPerSide: 8,
  textureSizePx: 512,
  forestCount: 500,
  rebuildSourceTree: false,
  compressionFormat: 'image/webp',
  compressionQuality: 0.8,
  normalDepthMode: 'lossless',
};

function scenario(
  id: string,
  label: string,
  settings: Partial<ImpostorBakerTestSettings>,
): TestScenario<ImpostorBakerTestSettings> {
  return {
    id,
    label,
    settings: { ...BASE, ...settings },
    warmupMs: settings.operation === 'render' ? 500 : 250,
    durationMs: settings.operation === 'render' ? 3000 : 1000,
  };
}

const FUNCTIONAL_V1: TestSuite<ImpostorBakerTestSettings> = {
  id: 'impostor-baker-functional',
  version: 1,
  title: 'Octahedral impostor build checks',
  purpose: 'functional',
  requiresVisualReview: true,
  scenarios: [
    scenario('hemisphere-oak', 'Hemispherical atlas · oak', {}),
    scenario('sphere-palm', 'Spherical atlas · palm', {
      species: 'palm',
      type: 'spherical',
      seed: 13,
    }),
    scenario('hemisphere-pine', 'Hemispherical atlas · pine', {
      species: 'pine',
      seed: 23,
    }),
  ],
};

const PERFORMANCE_V1: TestSuite<ImpostorBakerTestSettings> = {
  id: 'impostor-baker-cost',
  version: 1,
  title: 'Impostor bake and compression costs',
  purpose: 'performance',
  requiresVisualReview: true,
  scenarios: [
    scenario(
      'baseline-512-8-500',
      'Baseline · 512 px · 8² views · 500 instances',
      { operation: 'bake' },
    ),
    scenario('atlas-1024', 'Atlas size · 1024 px · 8² views', {
      operation: 'bake',
      textureSizePx: 1024,
    }),
    scenario('atlas-2048', 'Atlas size · 2048 px · 8² views', {
      operation: 'bake',
      textureSizePx: 2048,
    }),
    scenario('views-16', 'View count · 512 px · 16² views', {
      operation: 'bake',
      spritesPerSide: 16,
    }),
    scenario('forest-4000', 'Forest setup · 4,000 instances', {
      operation: 'bake',
      forestCount: 4000,
    }),
    scenario('render-500', 'Rendered field · 500 instances', {
      operation: 'render',
      forestCount: 500,
    }),
    scenario('render-2000', 'Rendered field · 2,000 instances', {
      operation: 'render',
      forestCount: 2000,
    }),
    scenario('render-4000', 'Rendered field · 4,000 instances', {
      operation: 'render',
      forestCount: 4000,
    }),
    scenario('source-tree-palm', 'Source rebuild + bake · palm', {
      operation: 'bake',
      species: 'palm',
      seed: 31,
      rebuildSourceTree: true,
    }),
    scenario('compression-webp', 'Atlas compression · WebP', {
      operation: 'compression',
      compressionFormat: 'image/webp',
      normalDepthMode: 'lossless',
    }),
  ],
};

export const IMPOSTOR_BAKER_TEST_HISTORY: readonly TestSuite<ImpostorBakerTestSettings>[] =
  [FUNCTIONAL_V1, PERFORMANCE_V1];
