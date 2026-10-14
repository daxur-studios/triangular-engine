/** A value a telemetry section reports. `undefined` entries are left out of the report. */
export type TelemetrySectionValue = string | number | boolean | null | undefined;

/**
 * Returns the values one telemetry section reports. It runs only when a report
 * is copied, so it may read signals and state without costing a frame.
 */
export type TelemetrySectionProvider = () => Readonly<Record<string, TelemetrySectionValue>>;

/**
 * Named sections a page adds to the **Copy for Agent** report, after the
 * engine's own block. Register from a component and call the returned function
 * when the component is destroyed, so the report never reads a stale page.
 */
export class TelemetrySections {
  private readonly providers = new Map<string, TelemetrySectionProvider>();

  /**
   * Adds or replaces the section called `name`.
   *
   * @returns A function that removes the section, unless another provider has
   *   since registered the same name.
   */
  register(name: string, provider: TelemetrySectionProvider): () => void {
    this.providers.set(name, provider);
    return () => {
      if (this.providers.get(name) === provider) this.providers.delete(name);
    };
  }

  /**
   * Formats every registered section as `name:` followed by indented `key: value`
   * lines, in registration order. Returns an empty string when none are registered.
   */
  format(): string {
    const lines: string[] = [];
    for (const [name, provider] of this.providers) {
      lines.push(`${name}:`);
      let values: Readonly<Record<string, TelemetrySectionValue>>;
      try {
        values = provider();
      } catch (error) {
        // A broken section must not stop the rest of the report from copying.
        console.warn(`Telemetry section "${name}" failed.`, error);
        lines.push('  error: provider threw');
        continue;
      }
      for (const [key, value] of Object.entries(values)) {
        if (value === undefined) continue;
        lines.push(`  ${key}: ${value}`);
      }
    }
    return lines.join('\n');
  }
}
