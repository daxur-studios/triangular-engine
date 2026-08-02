import { ISplineDefinition } from './spline-definition';
import {
  deserializeSplineDefinition,
  serializeSplineDefinition,
} from './spline-serialization';

function openWithPrecision(): ISplineDefinition {
  return {
    schemaVersion: 1,
    id: 'precision-open',
    interpolation: 'bezier',
    closed: false,
    points: [
      {
        position: [0.1 + 0.2, Math.PI, -1 / 3],
        handleOut: [1.23456789012345, 0, 0],
        roll: Math.SQRT2,
        channels: { widthM: 2.5, materialId: 3 },
      },
      { position: [10.987654321, 0, 5.5], handleIn: [-1, 0, 0] },
    ],
  };
}

function closedSquare(): ISplineDefinition {
  return {
    schemaVersion: 2,
    id: 'square',
    interpolation: 'linear',
    closed: true,
    invertInterior: true,
    points: [
      { position: [0, 0, 0] },
      { position: [10, 0, 0] },
      { position: [10, 0, 10] },
      { position: [0, 0, 10] },
    ],
  };
}

describe('serializeSplineDefinition / deserializeSplineDefinition', () => {
  it('round-trips an open spline with exact f64 precision', () => {
    const original = openWithPrecision();
    const json = serializeSplineDefinition(original);
    const restored = deserializeSplineDefinition(json);
    expect(restored).toEqual(original);
  });

  it('round-trips a closed spline without growing the point array', () => {
    const original = closedSquare();
    const json = serializeSplineDefinition(original);
    const restored = deserializeSplineDefinition(json);
    expect(restored.points.length).toBe(original.points.length);
    expect(restored).toEqual(original);
  });

  it('preserves schemaVersion as the format version, unrelated to caching', () => {
    const json = serializeSplineDefinition(closedSquare());
    const restored = deserializeSplineDefinition(json);
    expect(restored.schemaVersion).toBe(2);
  });

  it('rejects malformed JSON', () => {
    expect(() => deserializeSplineDefinition('{not valid json')).toThrowError(
      RangeError,
    );
  });

  it('rejects JSON that decodes to a non-object', () => {
    expect(() => deserializeSplineDefinition('42')).toThrowError(RangeError);
    expect(() => deserializeSplineDefinition('null')).toThrowError(RangeError);
  });

  it('rejects a decoded definition that fails validation', () => {
    const invalid = { ...closedSquare(), points: [{ position: [0, 0, 0] }] };
    expect(() =>
      deserializeSplineDefinition(JSON.stringify(invalid)),
    ).toThrowError(RangeError);
  });

  it('refuses to serialize an invalid definition', () => {
    const invalid = { ...openWithPrecision(), points: [] };
    expect(() => serializeSplineDefinition(invalid)).toThrowError(RangeError);
  });
});
