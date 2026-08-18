import { vec3Length, vec3Sub } from '../math/vec3';
import { IStateVector } from './kepler-elements';
import { KeplerianOrbitPropagator } from './propagator';
import { stateVectorToKeplerianElements } from './state-elements';

describe('KeplerianOrbitPropagator', () => {
  const mu = 3.986e14;

  it('recovers the epoch state at ut = epochUt', () => {
    const state: IStateVector = {
      positionM: [7_000_000, 1_000_000, 0],
      velocityMPerS: [-500, 6800, 1200],
    };
    const elements = stateVectorToKeplerianElements(state, mu, 500);
    const propagator = new KeplerianOrbitPropagator();

    const result = propagator.stateAt(elements, mu, 500);
    expect(
      vec3Length(vec3Sub(result.positionM, state.positionM)),
    ).toBeLessThanOrEqual(1e-3);
    expect(
      vec3Length(vec3Sub(result.velocityMPerS, state.velocityMPerS)),
    ).toBeLessThanOrEqual(1e-6);
  });

  it('conserves specific orbital energy and angular momentum magnitude over 1000 periods', () => {
    const state: IStateVector = {
      positionM: [7_000_000, 0, 0],
      velocityMPerS: [0, 6800, 3200],
    };
    const elements = stateVectorToKeplerianElements(state, mu, 0);
    const periodS = 2 * Math.PI * Math.sqrt(elements.semiMajorAxisM ** 3 / mu);
    const propagator = new KeplerianOrbitPropagator();

    function specificEnergy(s: IStateVector): number {
      const vMag = vec3Length(s.velocityMPerS);
      const rMag = vec3Length(s.positionM);
      return (vMag * vMag) / 2 - mu / rMag;
    }

    function angularMomentumMag(s: IStateVector): number {
      const [rx, ry, rz] = s.positionM;
      const [vx, vy, vz] = s.velocityMPerS;
      const hx = ry * vz - rz * vy;
      const hy = rz * vx - rx * vz;
      const hz = rx * vy - ry * vx;
      return Math.sqrt(hx * hx + hy * hy + hz * hz);
    }

    const initialEnergy = specificEnergy(state);
    const initialAngularMomentum = angularMomentumMag(state);

    const after1000Periods = propagator.stateAt(elements, mu, 1000 * periodS);
    const finalEnergy = specificEnergy(after1000Periods);
    const finalAngularMomentum = angularMomentumMag(after1000Periods);

    expect(
      Math.abs((finalEnergy - initialEnergy) / initialEnergy),
    ).toBeLessThanOrEqual(1e-12);
    expect(
      Math.abs(
        (finalAngularMomentum - initialAngularMomentum) /
          initialAngularMomentum,
      ),
    ).toBeLessThanOrEqual(1e-12);
  });

  it('returns to (approximately) the same position after exactly one period', () => {
    const state: IStateVector = {
      positionM: [7_000_000, 0, 500_000],
      velocityMPerS: [200, 7100, -300],
    };
    const elements = stateVectorToKeplerianElements(state, mu, 0);
    const periodS = 2 * Math.PI * Math.sqrt(elements.semiMajorAxisM ** 3 / mu);
    const propagator = new KeplerianOrbitPropagator();

    const after = propagator.stateAt(elements, mu, periodS);
    expect(
      vec3Length(vec3Sub(after.positionM, state.positionM)),
    ).toBeLessThanOrEqual(1e-2);
  });

  it('handles a negative ut relative to epoch (propagating backward)', () => {
    const state: IStateVector = {
      positionM: [7_000_000, 0, 0],
      velocityMPerS: [0, 6800, 3200],
    };
    const elements = stateVectorToKeplerianElements(state, mu, 1000);
    const propagator = new KeplerianOrbitPropagator();

    const before = propagator.stateAt(elements, mu, -500);
    expect(Number.isFinite(vec3Length(before.positionM))).toBeTrue();

    const back = propagator.stateAt(elements, mu, 1000);
    expect(
      vec3Length(vec3Sub(back.positionM, state.positionM)),
    ).toBeLessThanOrEqual(1e-3);
  });
});
