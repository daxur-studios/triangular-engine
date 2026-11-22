import { getBounds, mesh } from 'brepjs';

export function meshBody(shape) {
  const bounds = getBounds(shape);
  // A valid loft can tessellate to only a patch at the pole. Verify its coverage.
  for (const [tolerance, angularTolerance] of [[1.6, .8], [.55, .36], [.24, .22]]) {
    const data = mesh(shape, { tolerance, angularTolerance });
    const min = [Infinity, Infinity, Infinity];
    const max = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < data.vertices.length; i++) {
      const axis = i % 3;
      min[axis] = Math.min(min[axis], data.vertices[i]);
      max[axis] = Math.max(max[axis], data.vertices[i]);
    }
    const coversBounds = ['x', 'y', 'z'].every((axis, i) =>
      Math.abs(bounds[`${axis}Min`] - min[i]) <= 4 && Math.abs(bounds[`${axis}Max`] - max[i]) <= 4);
    if (data.triangles.length > 0 && coversBounds) return data;
  }
  throw new Error(`Tessellation lost part of a body with bounds ${JSON.stringify(bounds)}`);
}
