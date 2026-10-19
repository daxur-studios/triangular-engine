/**
 * Renderer constructor parameters with the engine defaults underneath: `powerPreference: 'high-performance'`, so a
 * hybrid-GPU laptop gets the discrete GPU unless the scene asks for `'low-power'` (or `'default'`) itself. The browser
 * may still ignore the preference: Chrome on Windows does for WebGPU and logs "The powerPreference option is currently
 * ignored ..." (crbug.com/369219127); there the Windows Graphics setting for the browser picks the GPU. The request is
 * kept for the platforms that honour it. Internal: not exported from the services index.
 */
export function withRendererDefaults<T extends object>(parameters: T): T & { powerPreference?: string } {
  return { powerPreference: 'high-performance', ...parameters };
}
