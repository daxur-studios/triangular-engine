import { TestBed } from '@angular/core/testing';
import { BufferAttribute, Mesh, PerspectiveCamera, Scene } from 'three';
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
});
