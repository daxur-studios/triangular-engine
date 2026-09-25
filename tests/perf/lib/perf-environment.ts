import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const REPO_ROOT = path.resolve(__dirname, '../../../');

export interface PerfGitIdentity {
  commit: string;
  branch: string;
  /** Uncommitted tracked or untracked changes existed when the run started. */
  dirty: boolean;
}

export interface PerfHostIdentity {
  os: string;
  osRelease: string;
  arch: string;
  cpuModel: string;
  cpuCount: number;
  totalMemoryGb: number;
  node: string;
  ci: boolean;
}

/**
 * Everything that makes two runs' timings comparable. Hash it into a short
 * `id`; history entries are only compared against entries with the same id.
 * The application revision is deliberately *not* part of the profile — it
 * is the variable being measured.
 */
export interface PerfProfile {
  id: string;
  label: string;
  host: PerfHostIdentity;
  browser: { name: string; version: string; headless: boolean; frameRateCap: 'uncapped-flags' | 'vsync' };
  gpu: { vendor: string | null; renderer: string | null; softwareRendering: boolean };
  viewport: { width: number; height: number; dpr: number };
}

function git(args: string[]): string | null {
  try {
    return execFileSync('git', args, { cwd: REPO_ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return null;
  }
}

export function gitIdentity(): PerfGitIdentity {
  const status = git(['status', '--porcelain']);
  return {
    commit: git(['rev-parse', 'HEAD']) ?? 'unavailable',
    branch: git(['rev-parse', '--abbrev-ref', 'HEAD']) ?? 'unavailable',
    dirty: status === null ? false : status.length > 0,
  };
}

export function hostIdentity(): PerfHostIdentity {
  const cpus = os.cpus();
  return {
    os: os.platform(),
    osRelease: os.release(),
    arch: os.arch(),
    cpuModel: cpus[0]?.model.trim() ?? 'unknown',
    cpuCount: cpus.length,
    totalMemoryGb: Math.round(os.totalmem() / 1024 ** 3),
    node: process.version,
    ci: Boolean(process.env['CI']),
  };
}

export function engineVersion(): string {
  try {
    const manifest = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'projects/triangular-engine/package.json'), 'utf8'));
    return String(manifest.version);
  } catch {
    return 'unavailable';
  }
}

/** SwiftShader / llvmpipe / WARP mean CPU rasterization: fine for trends, not GPU claims. */
export function isSoftwareRenderer(renderer: string | null | undefined): boolean {
  return /swiftshader|llvmpipe|softpipe|software|microsoft basic render|warp/i.test(renderer ?? '');
}

export function buildProfile(input: Omit<PerfProfile, 'id' | 'label'>): PerfProfile {
  const identity = {
    os: input.host.os,
    arch: input.host.arch,
    cpuModel: input.host.cpuModel,
    cpuCount: input.host.cpuCount,
    browser: input.browser.name,
    // Minor browser updates happen constantly; majors change the renderer.
    browserMajor: input.browser.version.split('.')[0],
    headless: input.browser.headless,
    frameRateCap: input.browser.frameRateCap,
    gpu: input.gpu.renderer,
    viewport: input.viewport,
  };
  const id = createHash('sha256').update(JSON.stringify(identity)).digest('hex').slice(0, 12);
  const gpuLabel = input.gpu.softwareRendering ? 'software-gl' : (input.gpu.renderer ?? 'unknown-gpu');
  const label = `${input.host.os}-${input.host.arch} ${input.host.cpuCount}c · ${input.browser.name} ${identity.browserMajor}${input.browser.headless ? ' headless' : ''} · ${gpuLabel}`;
  return { id, label, ...input };
}
