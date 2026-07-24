/**
 * Stable identity for one scatter instance, given to games for delta
 * overlays ("this tree was cut"). Composed, never hashed, so it stays
 * debuggable; games treat it as an opaque key, not a parseable value.
 */
export type ScatterInstanceId = string;

export interface IScatterCellIdentity {
  readonly worldSeed: number;
  readonly layerId: string;
  readonly speciesId: string;
  readonly generatorVersion: number;
  readonly cellKey: string;
}

const SEPARATOR = '::';

/** worldSeed + layer + species + generatorVersion + cell + candidate — never renumbers when density changes. */
export function composeScatterInstanceId(
  identity: IScatterCellIdentity,
  candidateKey: string,
): ScatterInstanceId {
  return [
    identity.worldSeed,
    identity.layerId,
    identity.speciesId,
    identity.generatorVersion,
    identity.cellKey,
    candidateKey,
  ].join(SEPARATOR);
}
