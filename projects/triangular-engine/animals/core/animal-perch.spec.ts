import { selectAnimalPerch } from './animal-perch';

describe('selectAnimalPerch', () => {
  const position = { x: 0, y: 4, z: 0 };
  const perches = [
    { id: 'far', position: { x: 8, y: 6, z: 0 } },
    { id: 'near', position: { x: 2, y: 5, z: 0 } },
    { id: 'occupied', position: { x: 1, y: 4, z: 0 }, available: false },
  ];

  it('chooses the nearest available consumer-provided socket', () => {
    expect(selectAnimalPerch(position, perches)?.id).toBe('near');
  });

  it('does not depend on input order and resolves ties by stable ID', () => {
    const tied = [
      { id: 'perch-b', position: { x: 1, y: 4, z: 0 } },
      { id: 'perch-a', position: { x: -1, y: 4, z: 0 } },
    ];
    expect(selectAnimalPerch(position, tied)?.id).toBe('perch-a');
    expect(selectAnimalPerch(position, [...tied].reverse())?.id).toBe('perch-a');
  });

  it('returns a defensive copy and undefined when no perch is available', () => {
    const selected = selectAnimalPerch(position, perches)!;
    selected.position.x = 999;
    expect(perches[1].position.x).toBe(2);
    expect(selectAnimalPerch(position, [
      { id: 'busy', position, available: false },
    ])).toBeUndefined();
  });

  it('rejects invalid sockets', () => {
    expect(() => selectAnimalPerch(position, [
      { id: '', position: { x: 0, y: 0, z: 0 } },
    ])).toThrowError(/ID/);
    expect(() => selectAnimalPerch(position, [
      { id: 'bad', position: { x: Number.NaN, y: 0, z: 0 } },
    ])).toThrowError(/finite/);
  });
});
