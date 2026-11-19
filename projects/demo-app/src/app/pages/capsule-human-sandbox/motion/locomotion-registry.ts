import { createBaselineLocomotionPlugin } from './baseline-locomotion.plugin';
import type { LocomotionPlugin } from './capsule-motion-types';
import { createCartoonKeyposePlugin } from './cartoon-keypose.plugin';
import { createProceduralStepperPlugin } from './procedural-stepper.plugin';

export const DEFAULT_LOCOMOTION_PLUGIN_ID = 'cartoon-keypose';

export function createDefaultLocomotionPlugins(): LocomotionPlugin[] {
  return [
    createBaselineLocomotionPlugin(),
    createProceduralStepperPlugin(),
    createCartoonKeyposePlugin(),
  ];
}

export function resolveLocomotionPlugin(
  plugins: readonly LocomotionPlugin[],
  pluginId?: string | null,
): LocomotionPlugin {
  return (
    plugins.find((plugin) => plugin.id === pluginId) ??
    plugins.find((plugin) => plugin.id === DEFAULT_LOCOMOTION_PLUGIN_ID) ??
    plugins[0]
  );
}
