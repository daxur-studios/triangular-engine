import {
  BufferAttribute,
  BufferGeometry,
  DirectionalLight,
  DoubleSide,
  Float32BufferAttribute,
  GridHelper,
  HemisphereLight,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  MeshStandardMaterial,
} from 'three';
import { EngineService } from 'triangular-engine';
import type { PartGeometry } from '../part/bracket';

/** Millimetres (brepjs) to metres (engine world units). */
const MM_TO_METERS = 0.001;
/** Grid extent in metres, matching a 1 m workbench. */
const GRID_SIZE_METERS = 1;
/** Grid subdivisions per metre. */
const GRID_DIVISIONS = 20;

/** Handle the component uses to push new geometry into a live `<scene>`. */
export interface PartSceneHandle {
  setPart(geometry: PartGeometry): void;
  setEdgesVisible(visible: boolean): void;
  dispose(): void;
}

/**
 * Add the CAD presentation layer to the engine scene an existing `<scene>`
 * already owns: CAD-style lighting, a 1 m grid, the part mesh and its true
 * B-Rep edge overlay. The engine keeps the renderer, camera, tick loop and
 * resize handling; this only adds and swaps objects.
 */
export function createPartScene(engine: EngineService): PartSceneHandle {
  engine.scene.add(new HemisphereLight('#ffffff', '#5b6470', 1.1));
  const keyLight = new DirectionalLight('#fff6ea', 1.6);
  keyLight.position.set(-0.6, 0.9, 0.8);
  engine.scene.add(keyLight);
  const fillLight = new DirectionalLight('#dfe9ff', 0.6);
  fillLight.position.set(0.7, 0.3, -0.6);
  engine.scene.add(fillLight);

  const grid = new GridHelper(GRID_SIZE_METERS, GRID_DIVISIONS, '#2c3a46', '#1b242c');
  engine.scene.add(grid);

  const material = new MeshStandardMaterial({
    color: '#c8d2dc',
    roughness: 0.42,
    metalness: 0.08,
    side: DoubleSide, // BREP tessellation winding is not guaranteed to face out.
    polygonOffset: true,
    polygonOffsetFactor: 1,
    polygonOffsetUnits: 1,
  });
  const edgeMaterial = new LineBasicMaterial({ color: '#0b1116' });

  const mesh = new Mesh(new BufferGeometry(), material);
  mesh.name = 'brep-part';
  engine.scene.add(mesh);

  const edgeLines = new LineSegments(new BufferGeometry(), edgeMaterial);
  edgeLines.name = 'brep-part-edges';
  edgeLines.renderOrder = 1;
  engine.scene.add(edgeLines);

  return {
    setPart(geometry: PartGeometry): void {
      const nextMesh = toBufferGeometry(geometry, true);
      const nextEdges = toBufferGeometry(geometry, false);

      // Rest the part on the grid: the mesh's lowest point becomes y = 0.
      nextMesh.computeBoundingBox();
      const lift = -(nextMesh.boundingBox?.min.y ?? 0);
      nextMesh.translate(0, lift, 0);
      nextEdges.translate(0, lift, 0);

      mesh.geometry.dispose();
      mesh.geometry = nextMesh;

      edgeLines.geometry.dispose();
      edgeLines.geometry = nextEdges;
    },
    setEdgesVisible(visible: boolean): void {
      edgeLines.visible = visible;
    },
    dispose(): void {
      mesh.geometry.dispose();
      material.dispose();
      edgeLines.geometry.dispose();
      edgeMaterial.dispose();
      engine.scene.remove(mesh, edgeLines, grid);
      grid.geometry.dispose();
      engine.scene.remove(keyLight, fillLight);
    },
  };
}

/**
 * Convert brepjs tessellation into an engine-ready geometry: Z-up to Y-up,
 * millimetres to metres, and the edge polylines when `withNormals` is false.
 */
function toBufferGeometry(geometry: PartGeometry, withNormals: boolean): BufferGeometry {
  const result = new BufferGeometry();
  if (withNormals) {
    result.setAttribute('position', new Float32BufferAttribute(geometry.position, 3));
    result.setAttribute('normal', new Float32BufferAttribute(geometry.normal, 3));
    result.setIndex(new BufferAttribute(geometry.index, 1));
  } else {
    result.setAttribute('position', new Float32BufferAttribute(geometry.edgePosition, 3));
  }
  result.rotateX(-Math.PI / 2);
  result.scale(MM_TO_METERS, MM_TO_METERS, MM_TO_METERS);
  return result;
}
