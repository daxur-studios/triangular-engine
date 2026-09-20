import { TestBed } from '@angular/core/testing';
import {
  BufferAttribute,
  LineSegments,
  Mesh,
  MeshBasicMaterial,
  PerspectiveCamera,
  Raycaster,
  Scene,
  Vector2,
  Vector3,
} from 'three';
import { EngineService } from 'triangular-engine';
import {
  buildPlanetGraphCore,
  IPlanetSurfaceSampler,
  IVec3,
} from 'triangular-engine/worldgen';
import { CellPlanetMorphViewComponent } from './cell-planet-morph-view.component';

describe('CellPlanetMorphViewComponent', () => {
  let scene: Scene;
  let camera: PerspectiveCamera;

  const mockSampler: IPlanetSurfaceSampler = {
    sample: (dir: IVec3) => ({
      elevation: 0.1,
      baseElevation: 0.1,
      ridgeRelief: 0,
      riverCarve: 0,
      seaLevel: 0,
      isLand: true,
    }),
  };

  beforeEach(() => {
    scene = new Scene();
    camera = new PerspectiveCamera();
    TestBed.configureTestingModule({
      imports: [CellPlanetMorphViewComponent],
      providers: [{ provide: EngineService, useValue: { scene, camera } }],
    });
  });

  it('instantiates and builds terrain and ocean meshes on init', () => {
    const fixture = TestBed.createComponent(CellPlanetMorphViewComponent);
    fixture.componentRef.setInput('sampler', mockSampler);
    fixture.componentRef.setInput('longitudeSegments', 16);
    fixture.componentRef.setInput('latitudeRings', 8);
    fixture.detectChanges();

    const comp = fixture.componentInstance;
    expect(comp.object3D().children.length).toBe(2); // terrain + ocean

    fixture.destroy();
    expect(comp.object3D().children.length).toBe(0);
  });

  it('evaluates surface transform for units in 3D and 2.5D view modes', () => {
    const fixture = TestBed.createComponent(CellPlanetMorphViewComponent);
    fixture.componentRef.setInput('sampler', mockSampler);
    fixture.componentRef.setInput('longitudeSegments', 16);
    fixture.componentRef.setInput('latitudeRings', 8);
    fixture.componentRef.setInput('radius', 2.0);
    fixture.componentRef.setInput('heightScale', 0.1);
    fixture.componentRef.setInput('morphProgress', 0); // 3D globe
    fixture.detectChanges();

    const comp = fixture.componentInstance;
    const dir: IVec3 = { x: 0, y: 0, z: 1 };
    const transform3D = comp.evaluateUnitTransform(dir, 0);
    // At center (0, 0, 1), position should be at Z = 0 (tangent to camera)
    expect(transform3D.position.x).toBeCloseTo(0, 3);
    expect(transform3D.position.y).toBeCloseTo(0, 3);
    expect(transform3D.position.z).toBeCloseTo(0, 3);

    // Switch to 2.5D map
    fixture.componentRef.setInput('morphProgress', 1.0);
    fixture.detectChanges();

    const transformFlat = comp.evaluateUnitTransform(dir, 0);
    expect(transformFlat.position.x).toBeCloseTo(0, 3);
    expect(transformFlat.position.y).toBeCloseTo(0, 3);
    expect(transformFlat.normal.z).toBeCloseTo(1, 3);

    fixture.destroy();
  });

  it('computes orthonormal basis in meridian and oblique tracking modes', () => {
    const fixture = TestBed.createComponent(CellPlanetMorphViewComponent);
    fixture.componentRef.setInput('sampler', mockSampler);
    fixture.componentRef.setInput('trackingMode', 'meridian');
    fixture.componentRef.setInput('trackingDirection', { x: 1, y: 0, z: 0 }); // 90 deg East
    fixture.detectChanges();

    const comp = fixture.componentInstance;
    const meridianBasis = comp.computeActiveBasis();
    expect(meridianBasis).toBeDefined();
    expect(meridianBasis?.up.y).toBeCloseTo(1, 4); // Poles locked to +Y
    expect(meridianBasis?.forward.x).toBeCloseTo(1, 4);

    fixture.componentRef.setInput('trackingMode', 'oblique');
    fixture.componentRef.setInput('trackingDirection', { x: 0, y: 1, z: 0 }); // North Pole
    fixture.detectChanges();

    const obliqueBasis = comp.computeActiveBasis();
    expect(obliqueBasis).toBeDefined();
    expect(obliqueBasis?.forward.y).toBeCloseTo(1, 4);

    fixture.destroy();
  });

  it('renders cell borders, territory borders, and tactical overlays when enabled', () => {
    const graph = buildPlanetGraphCore({
      cellCount: 30,
      seed: 1,
      relaxationIterations: 1,
    });
    const fixture = TestBed.createComponent(CellPlanetMorphViewComponent);
    fixture.componentRef.setInput('sampler', mockSampler);
    fixture.componentRef.setInput('graph', graph);
    fixture.componentRef.setInput('showCellBorders', true);
    fixture.componentRef.setInput('showTerritoryBorders', true);
    fixture.componentRef.setInput('showTacticalOverlay', true);
    fixture.detectChanges();

    const comp = fixture.componentInstance;
    const children = comp.object3D().children;

    // Expected meshes: morph-terrain, morph-ocean, morph-cell-borders, morph-territory-ribbons, morph-cell-overlay
    expect(children.length).toBe(5);
    expect(children.some((c) => c.name === 'morph-cell-borders')).toBeTrue();
    expect(
      children.some((c) => c.name === 'morph-territory-ribbons'),
    ).toBeTrue();
    expect(children.some((c) => c.name === 'morph-cell-overlay')).toBeTrue();

    // Check tactical overlay instance
    const overlay = comp.tacticalOverlay();
    expect(overlay).toBeDefined();
    expect(overlay?.cellCount).toBe(graph.cells.length);

    // Dynamic update of highlight without rebuilding meshes
    overlay?.setCellHighlight(0, '#ff0000', 0.8);
    overlay?.update();
    expect(comp.object3D().children.length).toBe(5); // unchanged

    fixture.destroy();
    expect(comp.object3D().children.length).toBe(0);
  });

  it('updates border geometries when clampBordersToSeaLevel is toggled', () => {
    const underwaterSampler: IPlanetSurfaceSampler = {
      sample: () => ({
        elevation: -0.5,
        baseElevation: -0.5,
        ridgeRelief: 0,
        riverCarve: 0,
        seaLevel: 0,
        isLand: false,
      }),
    };
    const graph = buildPlanetGraphCore({
      cellCount: 20,
      seed: 1,
      relaxationIterations: 1,
    });
    const fixture = TestBed.createComponent(CellPlanetMorphViewComponent);
    fixture.componentRef.setInput('sampler', underwaterSampler);
    fixture.componentRef.setInput('graph', graph);
    fixture.componentRef.setInput('showCellBorders', true);
    fixture.componentRef.setInput('seabedRelief', true);
    fixture.componentRef.setInput('clampBordersToSeaLevel', true);
    fixture.detectChanges();

    const comp = fixture.componentInstance;
    const borderMeshClamped = comp
      .object3D()
      .children.find((c) => c.name === 'morph-cell-borders') as LineSegments;
    expect(borderMeshClamped).toBeDefined();
    const flatPosClamped = borderMeshClamped.geometry.getAttribute(
      'aFlatPos',
    ) as BufferAttribute;
    for (let i = 0; i < flatPosClamped.count; i++) {
      expect(flatPosClamped.getZ(i)).toBeGreaterThanOrEqual(0.0);
    }

    // Toggle clampBordersToSeaLevel to false
    fixture.componentRef.setInput('clampBordersToSeaLevel', false);
    fixture.detectChanges();

    const borderMeshUnclamped = comp
      .object3D()
      .children.find((c) => c.name === 'morph-cell-borders') as LineSegments;
    const flatPosUnclamped = borderMeshUnclamped.geometry.getAttribute(
      'aFlatPos',
    ) as BufferAttribute;
    let foundNegative = false;
    for (let i = 0; i < flatPosUnclamped.count; i++) {
      if (flatPosUnclamped.getZ(i) < 0) {
        foundNegative = true;
        break;
      }
    }
    expect(foundNegative).toBeTrue();

    fixture.destroy();
  });

  it('updates border geometries when adaptiveReliefSubdivision is toggled', () => {
    const mountainSampler: IPlanetSurfaceSampler = {
      sample: (dir: IVec3) => {
        // High frequency noise / relief
        const elev = Math.sin(dir.x * 20) * 0.4 + 0.3;
        return {
          elevation: elev,
          baseElevation: elev,
          ridgeRelief: 0,
          riverCarve: 0,
          seaLevel: 0,
          isLand: true,
        };
      },
    };
    const graph = buildPlanetGraphCore({
      cellCount: 15,
      seed: 5,
      relaxationIterations: 1,
    });
    const fixture = TestBed.createComponent(CellPlanetMorphViewComponent);
    fixture.componentRef.setInput('sampler', mountainSampler);
    fixture.componentRef.setInput('graph', graph);
    fixture.componentRef.setInput('showCellBorders', true);
    fixture.componentRef.setInput('adaptiveReliefSubdivision', true);
    fixture.detectChanges();

    const comp = fixture.componentInstance;
    const borderMeshSubdivided = comp
      .object3D()
      .children.find((c) => c.name === 'morph-cell-borders') as LineSegments;
    const vertexCountSubdivided = borderMeshSubdivided.geometry.getAttribute('position').count;

    // Toggle off
    fixture.componentRef.setInput('adaptiveReliefSubdivision', false);
    fixture.detectChanges();

    const borderMeshUnsubdivided = comp
      .object3D()
      .children.find((c) => c.name === 'morph-cell-borders') as LineSegments;
    const vertexCountUnsubdivided = borderMeshUnsubdivided.geometry.getAttribute('position').count;

    // When adaptiveReliefSubdivision is true on mountain terrain, edges subdivide so vertex count is higher
    expect(vertexCountSubdivided).toBeGreaterThan(vertexCountUnsubdivided);

    fixture.destroy();
  });

  it('morphs the CPU pick geometry so flat-map picking matches the rendered surface', () => {
    const fixture = TestBed.createComponent(CellPlanetMorphViewComponent);
    fixture.componentRef.setInput('sampler', mockSampler);
    fixture.componentRef.setInput('longitudeSegments', 16);
    fixture.componentRef.setInput('latitudeRings', 8);
    fixture.componentRef.setInput('radius', 2.0);
    fixture.componentRef.setInput('morphProgress', 1.0); // 2.5D flat map
    fixture.detectChanges();

    const comp = fixture.componentInstance;
    const terrain = comp
      .object3D()
      .children.find((c) => c.name === 'morph-terrain') as Mesh;
    const position = terrain.geometry.getAttribute(
      'position',
    ) as BufferAttribute;
    const sphere = terrain.geometry.getAttribute(
      'aSpherePos',
    ) as BufferAttribute;
    const flat = terrain.geometry.getAttribute('aFlatPos') as BufferAttribute;

    // Raycast through a viewport-sized rect; resolveCellAtScreen is what triggers the sync.
    const viewport = {
      getBoundingClientRect: () => ({
        left: 0,
        top: 0,
        width: 400,
        height: 400,
      }),
    } as unknown as HTMLElement;
    comp.resolveCellAtScreen(200, 200, viewport);

    let differsFromSphere = false;
    for (let i = 0; i < position.count; i++) {
      if (Math.abs(position.getX(i) - sphere.getX(i)) > 1e-6) {
        differsFromSphere = true;
        break;
      }
    }
    expect(differsFromSphere).toBeTrue();

    // At full morph the CPU positions should equal the flat positions exactly.
    for (let i = 0; i < position.count; i++) {
      expect(position.getX(i)).toBeCloseTo(flat.getX(i), 5);
      expect(position.getY(i)).toBeCloseTo(flat.getY(i), 5);
      expect(position.getZ(i)).toBeCloseTo(flat.getZ(i), 5);
    }

    fixture.destroy();
  });

  it('exposes a raycast resolver that uses the visible morphed terrain', () => {
    const fixture = TestBed.createComponent(CellPlanetMorphViewComponent);
    fixture.componentRef.setInput('sampler', mockSampler);
    fixture.componentRef.setInput('longitudeSegments', 16);
    fixture.componentRef.setInput('latitudeRings', 8);
    fixture.componentRef.setInput('radius', 2.0);
    fixture.componentRef.setInput('morphProgress', 1.0);
    fixture.detectChanges();

    camera.position.set(0, 0, 10);
    camera.lookAt(0, 0, 0);
    camera.updateMatrixWorld();
    const raycaster = new Raycaster();
    raycaster.setFromCamera(new Vector2(0, 0), camera);

    const hit = fixture.componentInstance.raycastFocusResolver({
      raycaster,
      camera,
      ndc: new Vector2(0, 0),
      sceneChildren: scene.children,
    });

    expect(hit).not.toBeNull();
    expect(Array.isArray(hit) ? hit[2] : hit?.z).toBeCloseTo(0.1, 2);
    fixture.destroy();
  });

  it('updates effectiveSunDirection reactively when day/night inputs change', () => {
    const fixture = TestBed.createComponent(CellPlanetMorphViewComponent);
    fixture.componentRef.setInput('sampler', mockSampler);
    fixture.componentRef.setInput('longitudeSegments', 16);
    fixture.componentRef.setInput('latitudeRings', 8);
    fixture.componentRef.setInput('dayNightEnabled', true);
    fixture.componentRef.setInput('timeOfDay', 12);
    fixture.componentRef.setInput('seasonPhase', 0.25); // equinox
    fixture.detectChanges();

    const comp = fixture.componentInstance;
    expect(comp.effectiveSunDirection().z).toBeCloseTo(1, 3);

    // Change time of day to dawn (06:00)
    fixture.componentRef.setInput('timeOfDay', 6);
    fixture.detectChanges();
    expect(comp.effectiveSunDirection().x).toBeCloseTo(1, 3);

    // Provide explicit sun direction vector
    fixture.componentRef.setInput('sunDirection', new Vector3(0, 1, 0));
    fixture.detectChanges();
    expect(comp.effectiveSunDirection().y).toBeCloseTo(1, 3);

    fixture.destroy();
  });

  it('supports custom terrain and ocean materials via input', () => {
    const customTerrain = new MeshBasicMaterial({ color: 0xff0000 });
    const customOcean = new MeshBasicMaterial({ color: 0x0000ff });

    const fixture = TestBed.createComponent(CellPlanetMorphViewComponent);
    fixture.componentRef.setInput('sampler', mockSampler);
    fixture.componentRef.setInput('longitudeSegments', 16);
    fixture.componentRef.setInput('latitudeRings', 8);
    fixture.componentRef.setInput('customTerrainMaterial', customTerrain);
    fixture.componentRef.setInput('customOceanMaterial', customOcean);
    fixture.detectChanges();

    const comp = fixture.componentInstance;
    const terrain = comp.object3D().getObjectByName('morph-terrain') as Mesh;
    const ocean = comp.object3D().getObjectByName('morph-ocean') as Mesh;

    expect(terrain.material).toBe(customTerrain);
    expect(ocean.material).toBe(customOcean);

    fixture.destroy();
  });

  it('builds and disposes map border mesh when showMapBorder is toggled', () => {
    const fixture = TestBed.createComponent(CellPlanetMorphViewComponent);
    fixture.componentRef.setInput('sampler', mockSampler);
    fixture.componentRef.setInput('longitudeSegments', 16);
    fixture.componentRef.setInput('latitudeRings', 8);
    fixture.componentRef.setInput('showMapBorder', true);
    fixture.componentRef.setInput('mapBorderStyle', 'cartographic');
    fixture.detectChanges();

    const comp = fixture.componentInstance;
    const border = comp.object3D().getObjectByName('morph-map-border') as Mesh;
    expect(border).toBeDefined();
    expect(border.name).toBe('morph-map-border');

    // Toggle off
    fixture.componentRef.setInput('showMapBorder', false);
    fixture.detectChanges();
    expect(comp.object3D().getObjectByName('morph-map-border')).toBeUndefined();

    fixture.destroy();
  });

  it('builds border slider knobs and computes manual basis from projectionCenterLon/Lat', () => {
    const fixture = TestBed.createComponent(CellPlanetMorphViewComponent);
    fixture.componentRef.setInput('sampler', mockSampler);
    fixture.componentRef.setInput('longitudeSegments', 16);
    fixture.componentRef.setInput('latitudeRings', 8);
    fixture.componentRef.setInput('showMapBorder', true);
    fixture.componentRef.setInput('showBorderSliders', true);
    fixture.componentRef.setInput('projectionCenterLon', 45);
    fixture.componentRef.setInput('projectionCenterLat', 15);
    fixture.componentRef.setInput('morphProgress', 1.0); // flat view
    fixture.detectChanges();

    const comp = fixture.componentInstance;
    const topKnob = comp.object3D().getObjectByName('morph-border-top-knob') as Mesh;
    const leftKnob = comp.object3D().getObjectByName('morph-border-left-knob') as Mesh;

    expect(topKnob).toBeDefined();
    expect(leftKnob).toBeDefined();
    expect(topKnob.visible).toBeTrue();
    expect(leftKnob.visible).toBeTrue();

    const basis = comp.computeActiveBasis();
    expect(basis).toBeDefined();
    // 45 deg lon and 15 deg lat should produce an active oblique forward vector
    expect(basis!.forward.x).toBeGreaterThan(0);
    expect(basis!.forward.y).toBeGreaterThan(0);

    fixture.destroy();
  });

  it('handles pointer down, drag, and up interactions on border slider knobs', () => {
    const fixture = TestBed.createComponent(CellPlanetMorphViewComponent);
    fixture.componentRef.setInput('sampler', mockSampler);
    fixture.componentRef.setInput('longitudeSegments', 16);
    fixture.componentRef.setInput('latitudeRings', 8);
    fixture.componentRef.setInput('showMapBorder', true);
    fixture.componentRef.setInput('showBorderSliders', true);
    fixture.componentRef.setInput('morphProgress', 1.0);
    fixture.detectChanges();

    const comp = fixture.componentInstance;
    expect(comp.isDragging).toBeFalse();

    const viewport = {
      getBoundingClientRect: () => ({
        left: 0,
        top: 0,
        width: 800,
        height: 600,
      }),
    } as unknown as HTMLElement;

    // When clicking outside knobs and borders, pointerdown returns false
    const missEvent = { clientX: 10, clientY: 10 } as MouseEvent;
    expect(comp.onPointerDown(missEvent, viewport)).toBeFalse();
    expect(comp.isDragging).toBeFalse();

    // Calling onPointerUp resets any drag state
    comp.onPointerUp();
    expect(comp.isDragging).toBeFalse();

    fixture.destroy();
  });
});

