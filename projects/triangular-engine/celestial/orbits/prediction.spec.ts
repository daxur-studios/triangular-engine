import { ICelestialBody } from '../bodies/celestial-body';
import { HOME_MOON, HOME_PLANET } from '../bodies/stock-bodies';
import { orbitApsides } from './apsides';
import { KeplerianOrbitPropagator } from './propagator';
import { DEFAULT_MAX_DURATION_S, predictTrajectory } from './prediction';
import { stateVectorToKeplerianElements } from './state-elements';

const propagator = new KeplerianOrbitPropagator();
const mu = HOME_PLANET.muM3PerS2;

describe('predictTrajectory: periodic (no crossing)', () => {
  it('returns a single periodic segment for a LEO orbit that never nears the moon', () => {
    const elements = stateVectorToKeplerianElements(
      {
        positionM: [1_000_000, 0, 0],
        velocityMPerS: [0, 0, -Math.sqrt(mu / 1_000_000)],
      },
      mu,
      0,
    );
    const segments = predictTrajectory({
      bodies: [HOME_PLANET, HOME_MOON],
      bodyId: HOME_PLANET.id,
      elements,
      startUt: 0,
      propagator,
    });

    expect(segments.length).toBe(1);
    expect(segments[0].endReason).toBe('periodic');
    expect(segments[0].endUt).toBeUndefined();
    expect(segments[0].bodyId).toBe(HOME_PLANET.id);
  });
});

describe('predictTrajectory: constructed moon encounter', () => {
  // Transfer ellipse from a 700 km periapsis to a 12,000 km apoapsis (the
  // moon's orbital radius), with the moon's epoch phased so it sits at the
  // vessel's apoapsis point exactly when the vessel arrives there — see the
  // plan (step 4): "build the fixture by constructing the encounter".
  const rp = 700_000;
  const ra = 12_000_000;
  const aTransfer = (rp + ra) / 2;
  const vp = Math.sqrt(mu * (2 / rp - 1 / aTransfer));
  const transferPeriodS =
    2 * Math.PI * Math.sqrt((aTransfer * aTransfer * aTransfer) / mu);
  const tArrival = transferPeriodS / 2;

  const aMoon = HOME_MOON.orbit!.semiMajorAxisM;
  const moonMeanMotion = Math.sqrt(mu / (aMoon * aMoon * aMoon));
  const phasedMoon: ICelestialBody = {
    ...HOME_MOON,
    orbit: {
      ...HOME_MOON.orbit!,
      meanAnomalyAtEpochRad: Math.PI - moonMeanMotion * tArrival,
    },
  };
  const bodies = [HOME_PLANET, phasedMoon];

  const transferElements = stateVectorToKeplerianElements(
    { positionM: [rp, 0, 0], velocityMPerS: [0, 0, -vp] },
    mu,
    0,
  );

  it('finds a soiEntry into the moon near the predicted arrival time, with a close encounter', () => {
    const segments = predictTrajectory({
      bodies,
      bodyId: HOME_PLANET.id,
      elements: transferElements,
      startUt: 0,
      propagator,
    });

    expect(segments.length).toBeGreaterThanOrEqual(2);
    const [first, second] = segments;
    expect(first.bodyId).toBe(HOME_PLANET.id);
    expect(first.endReason).toBe('soiEntry');
    expect(first.endUt).toBeDefined();
    // The moon's SOI (~2.4e6 m radius) is entered on approach, strictly
    // before the vessel reaches the exact (phased) apoapsis/encounter time —
    // not "close to" it in an absolute-second sense.
    expect(first.endUt as number).toBeGreaterThan(0);
    expect(first.endUt as number).toBeLessThan(tArrival);

    expect(second.bodyId).toBe(phasedMoon.id);
    expect(second.startUt).toBe(first.endUt as number);
    expect(Number.isFinite(second.elements.eccentricity)).toBe(true);

    const { periapsisM } = orbitApsides(second.elements);
    // Perfect phasing (moon exactly at the vessel's apoapsis on arrival)
    // should produce a very close encounter, well inside the moon's SOI.
    expect(Math.abs(periapsisM)).toBeLessThan(1_000_000);
  });

  it('caps at maxTransitions instead of following the crossing into a new segment', () => {
    const segments = predictTrajectory({
      bodies,
      bodyId: HOME_PLANET.id,
      elements: transferElements,
      startUt: 0,
      propagator,
      maxTransitions: 0,
    });

    expect(segments.length).toBe(1);
    expect(segments[0].endReason).toBe('limitReached');
    expect(segments[0].endUt).toBeDefined();
    expect(segments[0].endUt as number).toBeGreaterThan(0);
    expect(segments[0].endUt as number).toBeLessThan(tArrival);
  });

  it('caps immediately when maxDurationS is exhausted before any search', () => {
    const segments = predictTrajectory({
      bodies,
      bodyId: HOME_PLANET.id,
      elements: transferElements,
      startUt: 0,
      propagator,
      maxDurationS: 0,
    });

    expect(segments.length).toBe(1);
    expect(segments[0].endReason).toBe('limitReached');
    expect(segments[0].endUt).toBe(0);
  });
});

describe('predictTrajectory: totality (always terminates)', () => {
  it('completes for a variety of elliptic and hyperbolic inputs without hanging', () => {
    const bodies = [HOME_PLANET, HOME_MOON];
    const cases: {
      positionM: [number, number, number];
      velocityMPerS: [number, number, number];
    }[] = [
      { positionM: [700_000, 0, 0], velocityMPerS: [0, 0, -3000] },
      { positionM: [700_000, 0, 0], velocityMPerS: [0, 0, -4500] },
      { positionM: [900_000, 100_000, 0], velocityMPerS: [-200, 0, 5200] },
      { positionM: [800_000, 0, 200_000], velocityMPerS: [0, 8000, 500] }, // escape-ish, hyperbolic
    ];

    for (const state of cases) {
      const elements = stateVectorToKeplerianElements(state, mu, 0);
      const segments = predictTrajectory({
        bodies,
        bodyId: HOME_PLANET.id,
        elements,
        startUt: 0,
        propagator,
      });
      expect(segments.length).toBeGreaterThan(0);
      expect(segments[segments.length - 1].endReason).toBeTruthy();
    }
  });

  it('exposes DEFAULT_MAX_DURATION_S as the hyperbolic search horizon', () => {
    expect(DEFAULT_MAX_DURATION_S).toBeGreaterThan(0);
  });
});
