/**
 * Serializable shapes returned by the in-page `window.__perfTest` bridge
 * (`projects/demo-app/src/app/testing/perf-harness/perf-harness.ts`).
 *
 * Mirrored here rather than imported so the Node test side never pulls
 * Angular/Three.js sources into Playwright's transpilation. Keep in sync
 * with `PERF_BRIDGE_VERSION` in the harness.
 */
export type PerfParamValue = number | string | boolean;

export interface PerfCheckPayload {
  name: string;
  expected: PerfParamValue;
  actual: PerfParamValue;
  pass: boolean;
}

export interface PerfFactsPayload {
  scenario: string | null;
  frame: { drawCalls: number; triangles: number };
  overhead: { drawCalls: number; triangles: number };
  renderer: { drawCalls: number; triangles: number; geometries: number; textures: number; programs: number };
  scenarioFacts: Record<string, PerfParamValue>;
  checks: PerfCheckPayload[];
}

export interface PerfLoadPayload {
  scenario: string;
  version: number;
  params: Record<string, PerfParamValue>;
  setupMs: number;
  firstFrameMs: number;
  facts: PerfFactsPayload;
}

export interface PerfWindowPayload {
  scenario: string;
  startedAt: number;
  durationMs: number;
  frames: number;
  frameIntervalMs: number[];
  cpuFrameMs: number[];
  renderCpuMs: number[];
  custom: Record<string, number[]>;
  drawCalls: { min: number; max: number; last: number };
  triangles: { min: number; max: number; last: number };
  longTasks: Array<{ startTime: number; duration: number }>;
  hiddenFrames: number;
  heapUsedBytes: { before: number | null; after: number | null };
  gcForced: boolean;
  errors: Array<{ source: string; message: string; at: number }>;
}

export interface PerfEnvironmentPayload {
  userAgent: string;
  hardwareConcurrency: number;
  deviceMemoryGb: number | null;
  devicePixelRatio: number;
  canvas: { width: number; height: number; cssWidth: number; cssHeight: number };
  webgl: { version: string; vendor: string; renderer: string; unmaskedVendor: string | null; unmaskedRenderer: string | null } | null;
  visibilityState: string;
  telemetry: string;
}

export interface PerfBridgeApi {
  environment(): Promise<PerfEnvironmentPayload>;
  load(id: string, params?: Record<string, PerfParamValue>): Promise<PerfLoadPayload>;
  measure(request: { warmupMs?: number; durationMs?: number }): Promise<PerfWindowPayload>;
  facts(): Promise<PerfFactsPayload>;
  unload(): Promise<void>;
  errors(): Promise<Array<{ source: string; message: string; at: number }>>;
}
