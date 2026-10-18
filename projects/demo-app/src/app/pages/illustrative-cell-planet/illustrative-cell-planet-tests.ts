import type { TestSuite } from 'triangular-engine/testing';
import type {
  IllustrativeLandmark,
  IllustrativeStyle,
} from './illustrative-cell-planet-fixture';

export interface IllustrativeSettings {
  readonly style: IllustrativeStyle;
  readonly landmark: IllustrativeLandmark;
  readonly altitudeM: number;
  readonly crisp: boolean;
  readonly facets: boolean;
  readonly motion: 'still' | 'zoom' | 'flyover' | 'teleport';
}

const settings = (
  style: IllustrativeStyle,
  landmark: IllustrativeLandmark,
): IllustrativeSettings => ({
  style,
  landmark,
  altitudeM: 90_000,
  crisp: true,
  facets: true,
  motion: 'still',
});
const landmarks = ['lowland', 'mountain', 'volcano', 'coast'] as const;

export const ILLUSTRATIVE_TEST_HISTORY: readonly TestSuite<IllustrativeSettings>[] =
  [
    {
      id: 'illustrative-terrain-look',
      version: 1,
      title: 'Same-world landform comparison',
      purpose: 'functional',
      requiresVisualReview: true,
      scenarios: landmarks.flatMap((landmark) =>
        (['cell-features', 'illustrative'] as const).map((style) => ({
          id: `${landmark}-${style}`,
          label: `${landmark}: ${style}`,
          durationMs: 500,
          warmupMs: 100,
          settings: settings(style, landmark),
        })),
      ),
    },
    {
      id: 'illustrative-terrain-cost',
      version: 1,
      title: 'Terrain cadence, zoom and repeated transitions',
      purpose: 'performance',
      requiresVisualReview: true,
      scenarios: [
        ...(['cell-features', 'illustrative'] as const).map((style) => ({
          id: `flyover-${style}`,
          label: `Four-landmark flyover: ${style}`,
          durationMs: 5000,
          warmupMs: 300,
          settings: {
            ...settings(style, 'lowland'),
            motion: 'flyover' as const,
          },
        })),
        {
          id: 'zoom',
          label: 'Illustrative volcano: 90 km → 22.5 km → 90 km',
          durationMs: 3500,
          warmupMs: 100,
          settings: {
            ...settings('illustrative', 'volcano'),
            motion: 'zoom' as const,
          },
        },
        {
          id: 'teleport',
          label:
            'Repeated coast, ridge, volcano, antimeridian and pole teleports',
          durationMs: 4000,
          warmupMs: 100,
          settings: {
            ...settings('illustrative', 'coast'),
            motion: 'teleport' as const,
          },
        },
        {
          id: 'vertex-colour',
          label: 'Coarse vertex colour control',
          durationMs: 1500,
          settings: { ...settings('illustrative', 'coast'), crisp: false },
        },
        {
        id: 'smooth-normals',
        label: 'Geometry unchanged, smooth normals control',
          durationMs: 1500,
          settings: { ...settings('illustrative', 'mountain'), facets: false },
        },
      ],
    },
  ];
