import { test, expect } from '@playwright/test';
import { comparePerformance, type PerformanceReading } from './cloud-performance-analysis';

test('U0P analysis detects slowdown and rejects noisy, busy, mismatched or missing evidence', () => {
  const readings = (values: number[]): PerformanceReading[] => values.map((gpuRenderMsPerFrame) => ({
    profileKey: 'nvidia-640x360-webgpu', gpuRenderMsPerFrame, knownContention: false, valid: true,
  }));
  const base = readings([1, 1.01, .99]);
  const slow = readings([2, 2.01, 1.99]);
  expect(comparePerformance(base, slow).verdict).toBe('slowdown-detected');
  expect(comparePerformance(base, readings([1.01, 1.02, 1])).verdict).toBe('unresolved');
  expect(comparePerformance(base, readings([1, 2, 3])).reasons).toContain('noisy');
  expect(comparePerformance(base, slow.map((r) => ({ ...r, knownContention: true }))).reasons).toContain('known-contention');
  expect(comparePerformance(base, slow.map((r) => ({ ...r, profileKey: 'amd' }))).reasons).toContain('profile-mismatch');
  expect(comparePerformance(base, slow.map((r) => ({ ...r, valid: false }))).verdict).toBe('inconclusive');
  expect(comparePerformance(base, readings([NaN, 2, 2])).verdict).toBe('inconclusive');
  expect(comparePerformance(base.slice(1), slow).reasons).toContain('insufficient-rounds');
  expect(comparePerformance([], []).verdict).toBe('inconclusive');
});
