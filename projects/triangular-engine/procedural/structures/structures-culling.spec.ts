import { Camera, Frustum, Matrix4, PerspectiveCamera, Vector3 } from 'three';
import { extractCameraFrustum, StructureSpatialGrid } from './public-api';

describe('StructureSpatialGrid & Frustum Culling', () => {
  let grid: StructureSpatialGrid;

  beforeEach(() => {
    grid = new StructureSpatialGrid(50); // 50m cells
  });

  it('inserts instances into spatial cells correctly', () => {
    grid.insert({ position: [10, 0, 10] }, 5);
    grid.insert({ position: [20, 0, 20] }, 5);
    grid.insert({ position: [80, 0, 80] }, 5);

    expect(grid.totalItemCount).toBe(3);
    expect(grid.cellCount).toBe(2); // (0,0) and (1,1)
  });

  it('culls items outside of camera frustum', () => {
    // Put items at X=0, Z=-100 (in front of camera) and Z=+100 (behind camera)
    grid.insert({ position: [0, 0, -100] }, 5);
    grid.insert({ position: [0, 0, 100] }, 5);

    const camera = new PerspectiveCamera(60, 1, 1, 500);
    camera.position.set(0, 0, 0);
    camera.lookAt(0, 0, -100);
    camera.updateMatrixWorld(true);

    const frustum = extractCameraFrustum(camera);
    const visible = grid.queryFrustum(frustum);

    expect(visible.length).toBe(1);
    expect(visible[0].position[2]).toBe(-100);
  });

  it('clears spatial cells cleanly', () => {
    grid.insert({ position: [0, 0, 0] }, 5);
    expect(grid.totalItemCount).toBe(1);
    grid.clear();
    expect(grid.totalItemCount).toBe(0);
    expect(grid.cellCount).toBe(0);
  });
});
