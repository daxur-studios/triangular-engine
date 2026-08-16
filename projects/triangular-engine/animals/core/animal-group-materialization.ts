import { AnimalGroupSnapshot } from './animal-group-timeline';
import { animalUnit } from './animal-hash';
import { FlockDefinition } from './flock-definition';
import { materializeFlock } from './flock-materialization';
import { AnimalObserver, FlockState } from './animal-types';

export type AnimalGroupMaterialization = Omit<
  FlockDefinition,
  'id' | 'seed' | 'origin' | 'count'
>;

/** @deprecated Legacy XZ/Y-up presentation fixture. Use `materializeLocalAnimalGroup`. */
export interface AnimalGroupFlightMaterialization extends AnimalGroupMaterialization {
  /** Directly sampled visual formation. It never advances hidden simulation. */
  formation?: 'static' | 'flight';
}

/**
 * Converts an arbitrary-time aggregate snapshot into deterministic nearby
 * flock members. Member identity and offsets come from the stable group, not
 * from query order or renderer-relative state.
 */
/**
 * @deprecated Legacy XZ/Y-up flock presentation retained for compatibility.
 * New games should use the shape-neutral `materializeLocalAnimalGroup` API.
 */
export function materializeAnimalGroup(
  snapshot: AnimalGroupSnapshot,
  observer: AnimalObserver,
  definition: AnimalGroupFlightMaterialization,
  previousVisible = false,
): FlockState[] {
  const speed = Math.hypot(snapshot.velocity.x, snapshot.velocity.y, snapshot.velocity.z);
  const directFlight = definition.formation === 'flight';
  const members = materializeFlock(
    {
      ...definition,
      id: snapshot.id,
      seed: snapshot.seed,
      origin: snapshot.position,
      count: snapshot.memberCount,
      speed: snapshot.activity === 'travel' ? (directFlight ? speed : definition.speed) : 0,
      travelDirection: directFlight ? snapshot.velocity : definition.travelDirection,
    },
    observer,
    previousVisible,
  );
  if (!directFlight) return members;

  // Cruise reference used only to normalise how "fast" the group currently
  // is; it does not gate any term to exactly zero on its own, so nothing
  // here can collapse the flock the way a velocity-normalised basis would.
  const cruiseSpeed = definition.speed > 0 ? definition.speed : 1;
  const streamWeight = smoothstep01(speed / cruiseSpeed);
  const forward =
    speed > 1e-6
      ? { x: snapshot.velocity.x / speed, z: snapshot.velocity.z / speed }
      : { x: 0, z: 1 };
  const side = { x: -forward.z, z: forward.x };
  const dwellEnvelope =
    snapshot.activity === 'travel'
      ? 0
      : Math.sin(Math.PI * Math.min(1, Math.max(0, snapshot.activityProgress ?? 0)));
  const restWeight = snapshot.activity === 'rest' ? dwellEnvelope : 0;
  const feedWeight = snapshot.activity === 'feed' ? dwellEnvelope : 0;

  return members.map((member, index) => {
    // Organic wander: present at every activity and every speed, on a fixed
    // world basis rather than the (potentially degenerate) travel direction,
    // so members never collapse onto the group centre when the group stops.
    // Two incommensurate sinusoids per axis (a Lissajous-style sum) instead
    // of one circular orbit, so no member ever traces a repeating circle -
    // the path only approximately closes after a very long, seed-varied
    // period, which reads as organic wander rather than a carousel.
    const phaseA = animalUnit(snapshot.seed, index) * Math.PI * 2;
    const phaseB = animalUnit(snapshot.seed + 13, index) * Math.PI * 2;
    const rateA = 0.11 + animalUnit(snapshot.seed + 5, index) * 0.17;
    const rateB = 0.29 + animalUnit(snapshot.seed + 17, index) * 0.23;
    const radius = definition.spacing * (0.4 + animalUnit(snapshot.seed + 3, index) * 0.7);

    const wanderX =
      radius * (0.6 * Math.cos(phaseA + snapshot.time * rateA) + 0.4 * Math.cos(phaseB + snapshot.time * rateB));
    const wanderZ =
      radius * (0.6 * Math.sin(phaseA + snapshot.time * rateA) + 0.4 * Math.sin(phaseB + snapshot.time * rateB));
    const bobPhase = animalUnit(snapshot.seed + 11, index) * Math.PI * 2;
    const bobRate2 = 0.6 + animalUnit(snapshot.seed + 19, index) * 0.5;
    const bob =
      (0.6 * Math.sin(snapshot.time * 0.9 + bobPhase) + 0.4 * Math.sin(snapshot.time * bobRate2 + phaseB)) *
      definition.spacing *
      0.08;

    // Dwell behaviours blend in and back out over the dwell interval. The
    // envelope is zero at arrival/departure, preserving the same continuous
    // boundary as the eased route velocity. Rest compacts into stable seeded
    // slots; feed expands into a quicker, low-amplitude searching pattern.
    const settledRadius = radius * 0.42;
    const settledX = settledRadius * Math.cos(phaseA);
    const settledZ = settledRadius * Math.sin(phaseA);
    const feedingX = radius * 1.3 * Math.cos(phaseA + snapshot.time * (rateA * 2.4));
    const feedingZ = radius * 1.3 * Math.sin(phaseB + snapshot.time * (rateB * 2.1));
    const activityX =
      wanderX + restWeight * (settledX - wanderX) + feedWeight * (feedingX - wanderX);
    const activityZ =
      wanderZ + restWeight * (settledZ - wanderZ) + feedWeight * (feedingZ - wanderZ);
    const activityBob = bob * (1 - restWeight * 0.85 + feedWeight * 0.35);

    // Directional streaming: a loose trailing spread along the current
    // heading. Its weight fades continuously to zero as speed fades to
    // zero, so it never pops when the group's activity changes - it just
    // gently dissolves back into the organic wander above.
    const trail = -streamWeight * definition.spacing * (0.3 + animalUnit(snapshot.seed + 9, index) * 0.5);
    const drift = streamWeight * Math.sin(snapshot.time * 1.3 + phaseA) * definition.spacing * 0.25;
    const lift = streamWeight * Math.sin(snapshot.time * 4 + phaseA) * definition.spacing * 0.1;

    return {
      ...member,
      position: {
        x: snapshot.position.x + activityX + forward.x * trail + side.x * drift,
        y: snapshot.position.y + activityBob + lift,
        z: snapshot.position.z + activityZ + forward.z * trail + side.z * drift,
      },
      velocity: snapshot.velocity,
    };
  });
}

function smoothstep01(value: number): number {
  const clamped = Math.min(1, Math.max(0, value));
  return clamped * clamped * (3 - 2 * clamped);
}
