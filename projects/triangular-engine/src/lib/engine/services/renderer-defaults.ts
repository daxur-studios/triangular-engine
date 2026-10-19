/**
 * Renderer constructor parameters with the engine defaults underneath: `powerPreference: 'high-performance'`, so a
 * hybrid-GPU laptop gets the discrete GPU unless the scene asks for `'low-power'` (or `'default'`) itself. The browser
 * may still ignore the preference. Internal: not exported from the services index.
 */
export function withRendererDefaults<T extends object>(parameters: T): T & { powerPreference?: string } {
  return { powerPreference: 'high-performance', ...parameters };
}
