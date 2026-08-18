import { ICelestialBody } from '../bodies/celestial-body';
import { Vec3d, vec3Length, vec3Sub } from '../math/vec3';
import { ILuminousDisc, IOccludingDisc } from './eclipse';

/** Maximum local bodies forwarded to the bounded receiver shader. */
export const LOCAL_ECLIPSE_CASTER_LIMIT = 8;

/** Chooses the physically relevant family of eclipse casters for one receiver. */
export function selectLocalEclipseCasters(
  receiver: ICelestialBody,
  bodies: readonly ICelestialBody[],
  positionsByBodyId: ReadonlyMap<string, Vec3d>,
): { source: ILuminousDisc | null; occluders: readonly IOccludingDisc[] } {
  const sourceBody = bodies.find((body) => body.kind === 'star');
  const receiverPosition = positionsByBodyId.get(receiver.id);
  if (!sourceBody || !receiverPosition) return { source: null, occluders: [] };

  const sourcePosition = positionsByBodyId.get(sourceBody.id);
  if (!sourcePosition) return { source: null, occluders: [] };

  const relatedBodyIds = new Set<string>();
  if (receiver.parentBodyId && receiver.parentBodyId !== sourceBody.id) {
    relatedBodyIds.add(receiver.parentBodyId);
    for (const body of bodies) {
      if (body.parentBodyId === receiver.parentBodyId)
        relatedBodyIds.add(body.id);
    }
  }
  for (const body of bodies) {
    if (body.parentBodyId === receiver.id) relatedBodyIds.add(body.id);
  }
  relatedBodyIds.delete(receiver.id);
  relatedBodyIds.delete(sourceBody.id);

  const occluders = bodies
    .filter((body) => relatedBodyIds.has(body.id))
    .flatMap((body) => {
      const centerM = positionsByBodyId.get(body.id);
      return centerM
        ? [{ bodyId: body.id, centerM, radiusM: body.radiusM }]
        : [];
    })
    .sort(
      (a, b) =>
        apparentSize(b, receiverPosition) - apparentSize(a, receiverPosition),
    )
    .slice(0, LOCAL_ECLIPSE_CASTER_LIMIT);

  return {
    source: {
      bodyId: sourceBody.id,
      centerM: sourcePosition,
      radiusM: sourceBody.radiusM,
    },
    occluders,
  };
}

/** Broad-phase sort key: large apparent discs deserve the bounded shader slots first. */
function apparentSize(body: IOccludingDisc, receiverPosition: Vec3d): number {
  return (
    body.radiusM /
    Math.max(vec3Length(vec3Sub(body.centerM, receiverPosition)), 1)
  );
}
