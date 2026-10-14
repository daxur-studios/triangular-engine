import { fakeAsync, flushMicrotasks, TestBed } from '@angular/core/testing';
import { Subject } from 'rxjs';
import { BatchedMesh, PerspectiveCamera, Scene } from 'three';
import { EngineService } from 'triangular-engine';
import { ConstantTerrainField } from '../core/terrain-field';
import { PlaneTerrainDomain } from '../domains/plane-terrain-domain';
import type { IPlaneTerrainPatchAddress } from '../domains/plane-terrain-domain';
import { generateTerrainPatchMesh } from '../meshing/terrain-patch-mesher';
import {
  ITerrainSurfaceGenerationRequest,
  ITerrainSurfaceLodStats,
  ITerrainSurfaceSelectionRequest,
  TerrainSurfaceComponent,
} from './terrain-surface.component';

describe('TerrainSurfaceComponent', () => {
  let scene: Scene;
  let camera: PerspectiveCamera;
  let beforeRender$: Subject<void>;

  beforeEach(() => {
    scene = new Scene();
    camera = new PerspectiveCamera();
    beforeRender$ = new Subject<void>();
    TestBed.configureTestingModule({
      imports: [TerrainSurfaceComponent],
      providers: [
        {
          provide: EngineService,
          useValue: { scene, camera, beforeRender$ },
        },
      ],
    });
  });

  it('follows the engine camera and replaces coarse patches with nearby detail', () => {
    const fixture = TestBed.createComponent(TerrainSurfaceComponent);
    fixture.componentRef.setInput('field', new ConstantTerrainField(0));
    fixture.componentRef.setInput('domain', new PlaneTerrainDomain(800));
    fixture.componentRef.setInput('roots', [{ level: 0, x: 0, z: 0 }]);
    fixture.componentRef.setInput('maxLod', 2);
    fixture.componentRef.setInput('refinementDistance', 1_200);
    fixture.componentRef.setInput('resolution', 4);
    fixture.componentRef.setInput('generationBudget', 100);
    camera.position.set(5_000, 100, 5_000);
    fixture.detectChanges();

    beforeRender$.next();
    expect(scene.children.length).toBe(1);
    expect(scene.children[0].children.length).toBe(1);

    camera.position.set(400, 100, -400);
    beforeRender$.next();
    expect(scene.children[0].children.length).toBe(16);

    fixture.destroy();
    expect(scene.children.length).toBe(0);
  });

  it('uses an explicit LOD position instead of the camera when supplied', () => {
    const fixture = TestBed.createComponent(TerrainSurfaceComponent);
    fixture.componentRef.setInput('field', new ConstantTerrainField(0));
    fixture.componentRef.setInput('domain', new PlaneTerrainDomain(800));
    fixture.componentRef.setInput('roots', [{ level: 0, x: 0, z: 0 }]);
    fixture.componentRef.setInput('lodPosition', [400, 100, -400]);
    fixture.componentRef.setInput('maxLod', 1);
    fixture.componentRef.setInput('refinementDistance', 1_200);
    fixture.componentRef.setInput('resolution', 4);
    fixture.componentRef.setInput('generationBudget', 100);
    camera.position.set(5_000, 100, 5_000);
    fixture.detectChanges();

    beforeRender$.next();
    expect(scene.children[0].children.length).toBe(1);

    beforeRender$.next();
    expect(scene.children[0].children.length).toBe(4);
  });

  it('freezes the selected LOD cut while the camera moves', () => {
    const fixture = TestBed.createComponent(TerrainSurfaceComponent);
    fixture.componentRef.setInput('field', new ConstantTerrainField(0));
    fixture.componentRef.setInput('domain', new PlaneTerrainDomain(800));
    fixture.componentRef.setInput('roots', [{ level: 0, x: 0, z: 0 }]);
    fixture.componentRef.setInput('maxLod', 1);
    fixture.componentRef.setInput('refinementDistance', 1_200);
    fixture.componentRef.setInput('resolution', 4);
    fixture.componentRef.setInput('generationBudget', 100);
    camera.position.set(5_000, 100, 5_000);
    fixture.detectChanges();
    beforeRender$.next();
    expect(scene.children[0].children.length).toBe(1);

    fixture.componentRef.setInput('freezeLod', true);
    fixture.detectChanges();
    camera.position.set(400, 100, -400);
    beforeRender$.next();
    expect(scene.children[0].children.length).toBe(1);

    fixture.componentRef.setInput('freezeLod', false);
    fixture.detectChanges();
    beforeRender$.next();
    expect(scene.children[0].children.length).toBe(4);
  });

  it('keeps the previous cut visible until an asynchronous replacement is complete', fakeAsync(() => {
    const fixture = TestBed.createComponent(TerrainSurfaceComponent);
    const generator = async (
      request: ITerrainSurfaceGenerationRequest<IPlaneTerrainPatchAddress>,
    ) => {
      await Promise.resolve();
      return generateTerrainPatchMesh(request.field, request.domain, request);
    };
    fixture.componentRef.setInput('field', new ConstantTerrainField(0));
    fixture.componentRef.setInput('domain', new PlaneTerrainDomain(800));
    fixture.componentRef.setInput('roots', [{ level: 0, x: 0, z: 0 }]);
    fixture.componentRef.setInput('maxLod', 1);
    fixture.componentRef.setInput('refinementDistance', 1_200);
    fixture.componentRef.setInput('resolution', 4);
    fixture.componentRef.setInput('generationBudget', 100);
    fixture.componentRef.setInput('meshGenerator', generator);
    camera.position.set(5_000, 100, 5_000);
    fixture.detectChanges();

    beforeRender$.next();
    expect(scene.children[0]?.children.length ?? 0).toBe(0);
    flushMicrotasks();
    beforeRender$.next();
    expect(scene.children[0].children.length).toBe(1);

    camera.position.set(400, 100, -400);
    beforeRender$.next();
    expect(scene.children[0].children.length).toBe(1);
    flushMicrotasks();
    beforeRender$.next();
    expect(scene.children[0].children.length).toBe(4);
  }));

  it('reprioritizes a still-selected patch while the camera keeps moving', () => {
    const fixture = TestBed.createComponent(TerrainSurfaceComponent);
    const generated: IPlaneTerrainPatchAddress[] = [];
    const generator = (
      request: ITerrainSurfaceGenerationRequest<IPlaneTerrainPatchAddress>,
    ) => {
      generated.push(request.address);
      return generateTerrainPatchMesh(request.field, request.domain, request);
    };
    const roots = [
      { level: 0, x: 0, z: 0 },
      { level: 0, x: 2, z: 0 },
      { level: 0, x: 0, z: 2 },
    ];
    fixture.componentRef.setInput('field', new ConstantTerrainField(0));
    fixture.componentRef.setInput('domain', new PlaneTerrainDomain(800));
    fixture.componentRef.setInput('roots', roots);
    fixture.componentRef.setInput('maxLod', 0);
    fixture.componentRef.setInput('resolution', 4);
    fixture.componentRef.setInput('generationBudget', 1);
    fixture.componentRef.setInput(
      'patchSelector',
      ({ roots: selected }: ITerrainSurfaceSelectionRequest<IPlaneTerrainPatchAddress>) =>
        selected,
    );
    fixture.componentRef.setInput('meshGenerator', generator);
    camera.position.set(2_000, 100, -2_000);
    fixture.detectChanges();

    beforeRender$.next();
    expect(generated.length).toBe(1);

    camera.position.set(400, 100, -400);
    beforeRender$.next();

    expect(generated[1]).toEqual({ level: 0, x: 0, z: 0 });
    fixture.destroy();
  });

  it('commits a ready child group during movement without exposing a partial replacement', async () => {
    const fixture = TestBed.createComponent(TerrainSurfaceComponent);
    const completions = new Map<string, () => void>();
    const generator = (
      request: ITerrainSurfaceGenerationRequest<IPlaneTerrainPatchAddress>,
    ) =>
      new Promise((resolve) => {
        const key = JSON.stringify(request.address);
        completions.set(key, () => {
          completions.delete(key);
          resolve(generateTerrainPatchMesh(request.field, request.domain, request));
        });
      });
    fixture.componentRef.setInput('field', new ConstantTerrainField(0));
    fixture.componentRef.setInput('domain', new PlaneTerrainDomain(800));
    fixture.componentRef.setInput('roots', [{ level: 0, x: 0, z: 0 }]);
    fixture.componentRef.setInput('maxLod', 1);
    fixture.componentRef.setInput('refinementDistance', 1_200);
    fixture.componentRef.setInput('resolution', 4);
    fixture.componentRef.setInput('generationBudget', 100);
    fixture.componentRef.setInput('meshGenerator', generator);
    camera.position.set(5_000, 100, 5_000);
    fixture.detectChanges();

    beforeRender$.next();
    completions.get(JSON.stringify({ level: 0, x: 0, z: 0 }))!();
    await Promise.resolve();
    await Promise.resolve();
    beforeRender$.next();
    expect(scene.children[0].children.length).toBe(1);

    camera.position.set(400, 100, -400);
    beforeRender$.next();
    const childAddresses = [
      { level: 1, x: 0, z: 0 },
      { level: 1, x: 1, z: 0 },
      { level: 1, x: 0, z: 1 },
      { level: 1, x: 1, z: 1 },
    ];
    completions.get(JSON.stringify(childAddresses[0]))!();
    await Promise.resolve();
    await Promise.resolve();
    beforeRender$.next();
    expect(scene.children[0].children.length).toBe(1);

    for (const address of childAddresses.slice(1))
      completions.get(JSON.stringify(address))!();
    await Promise.resolve();
    await Promise.resolve();
    beforeRender$.next();
    expect(scene.children[0].children.length).toBe(4);
  });

  it('keeps batched residents bounded while zooming between complete LOD cuts', () => {
    const fixture = TestBed.createComponent(TerrainSurfaceComponent);
    const roots: IPlaneTerrainPatchAddress[] = [
      { level: 0, x: 0, z: 0 },
      { level: 0, x: 1, z: 0 },
      { level: 0, x: 0, z: 1 },
      { level: 0, x: 1, z: 1 },
    ];
    fixture.componentRef.setInput('field', new ConstantTerrainField(0));
    fixture.componentRef.setInput('domain', new PlaneTerrainDomain(800));
    fixture.componentRef.setInput('roots', roots);
    fixture.componentRef.setInput('maxLod', 1);
    fixture.componentRef.setInput('maxPatches', 7);
    fixture.componentRef.setInput('resolution', 4);
    fixture.componentRef.setInput('generationBudget', 100);
    fixture.componentRef.setInput('batching', true);
    fixture.componentRef.setInput(
      'patchSelector',
      ({ domain, roots: selected, cameraWorldM }:
        ITerrainSurfaceSelectionRequest<IPlaneTerrainPatchAddress>) => {
        const splitIndex = cameraWorldM[0] < 0 ? 0 : 1;
        return selected.flatMap((root, index) =>
          index === splitIndex ? domain.getChildren(root) : [root],
        );
      },
    );
    camera.position.set(5_000, 100, 5_000);
    fixture.detectChanges();
    beforeRender$.next();

    for (let index = 0; index < 24; index += 1) {
      camera.position.x = index % 2 === 0 ? -400 : 400;
      beforeRender$.next();
      const batch = scene.children[0].children.find(
        (child): child is BatchedMesh => child instanceof BatchedMesh,
      );
      expect(batch?.instanceCount).toBe(7);
    }

    fixture.destroy();
  });

  it('grows the batch to hold a cut larger than its starting capacity', () => {
    const fixture = TestBed.createComponent(TerrainSurfaceComponent);
    const tilesPerSide = 18;
    const roots: IPlaneTerrainPatchAddress[] = [];
    for (let x = 0; x < tilesPerSide; x += 1) {
      for (let z = 0; z < tilesPerSide; z += 1) roots.push({ level: 0, x, z });
    }
    fixture.componentRef.setInput('field', new ConstantTerrainField(0));
    fixture.componentRef.setInput('domain', new PlaneTerrainDomain(800));
    fixture.componentRef.setInput('roots', roots);
    fixture.componentRef.setInput('maxLod', 0);
    // Starts the batch at its 256-patch minimum.
    fixture.componentRef.setInput('maxPatches', 1);
    fixture.componentRef.setInput('resolution', 2);
    fixture.componentRef.setInput('generationBudget', roots.length);
    fixture.componentRef.setInput('batching', true);
    camera.position.set(0, 100, 0);
    fixture.detectChanges();
    beforeRender$.next();
    beforeRender$.next();

    const batch = scene.children[0].children.find(
      (child): child is BatchedMesh => child instanceof BatchedMesh,
    );
    expect(batch?.instanceCount).toBe(roots.length);
    expect(batch!.maxInstanceCount).toBeGreaterThanOrEqual(roots.length);
    fixture.destroy();
  });

  it('hides batched residents patchVisibility rejects and re-evaluates them on reselection', () => {
    const fixture = TestBed.createComponent(TerrainSurfaceComponent);
    const roots: IPlaneTerrainPatchAddress[] = [
      { level: 0, x: 0, z: 0 },
      { level: 0, x: 1, z: 0 },
    ];
    let visibleX = 0;
    const measure = jasmine
      .createSpy('measure')
      .and.callFake((address: IPlaneTerrainPatchAddress) => ({ x: address.x }));
    fixture.componentRef.setInput('field', new ConstantTerrainField(0));
    fixture.componentRef.setInput('domain', new PlaneTerrainDomain(800));
    fixture.componentRef.setInput('roots', roots);
    fixture.componentRef.setInput('maxLod', 0);
    fixture.componentRef.setInput('resolution', 4);
    fixture.componentRef.setInput('generationBudget', 100);
    fixture.componentRef.setInput('batching', true);
    fixture.componentRef.setInput(
      'patchSelector',
      ({ roots: selected }: ITerrainSurfaceSelectionRequest<IPlaneTerrainPatchAddress>) => selected,
    );
    fixture.componentRef.setInput('patchVisibility', {
      measure,
      isVisible: (_address: IPlaneTerrainPatchAddress, bounds: { x: number }) =>
        bounds.x === visibleX,
    });
    camera.position.set(0, 100, 0);
    fixture.detectChanges();
    beforeRender$.next();
    beforeRender$.next();

    const batch = scene.children[0].children.find(
      (child): child is BatchedMesh => child instanceof BatchedMesh,
    )!;
    const visibleIds = () =>
      [0, 1].filter((id) => batch.getVisibleAt(id)).map((id) => measure.calls.all()[id].args[0].x);
    expect(batch.instanceCount).toBe(2);
    expect(measure).toHaveBeenCalledTimes(2);
    expect(visibleIds()).toEqual([0]);

    visibleX = 1;
    camera.position.x = 10;
    beforeRender$.next();
    expect(visibleIds()).toEqual([1]);
    expect(measure).toHaveBeenCalledTimes(2);
    fixture.destroy();
  });

  /** Two level-0 roots whose children are both selected: root x=0 is nearest to the camera. */
  function createSiblingGroupFixture(
    inputs: Record<string, unknown>,
  ) {
    const fixture = TestBed.createComponent(TerrainSurfaceComponent);
    const generated: IPlaneTerrainPatchAddress[] = [];
    const generator = (
      request: ITerrainSurfaceGenerationRequest<IPlaneTerrainPatchAddress>,
    ) => {
      generated.push(request.address);
      return generateTerrainPatchMesh(request.field, request.domain, request);
    };
    fixture.componentRef.setInput('field', new ConstantTerrainField(0));
    fixture.componentRef.setInput('domain', new PlaneTerrainDomain(800));
    fixture.componentRef.setInput('roots', [
      { level: 0, x: 0, z: 0 },
      { level: 0, x: 1, z: 0 },
    ]);
    fixture.componentRef.setInput('maxLod', 1);
    fixture.componentRef.setInput('resolution', 4);
    fixture.componentRef.setInput('generationBudget', 100);
    fixture.componentRef.setInput(
      'patchSelector',
      ({ domain, roots: selected }: ITerrainSurfaceSelectionRequest<IPlaneTerrainPatchAddress>) =>
        selected.flatMap((root) => domain.getChildren(root)),
    );
    fixture.componentRef.setInput('meshGenerator', generator);
    for (const [name, value] of Object.entries(inputs)) {
      fixture.componentRef.setInput(name, value);
    }
    camera.position.set(0, 100, 0);
    fixture.detectChanges();
    // The initial coarse cover: both roots.
    beforeRender$.next();
    expect(generated.length).toBe(2);
    generated.length = 0;
    return { fixture, generated };
  }

  it('generates sibling groups the camera may see before groups it cannot, then the rest', () => {
    const estimate = jasmine
      .createSpy('estimate')
      .and.callFake((address: IPlaneTerrainPatchAddress) => address.x >= 2);
    const { fixture, generated } = createSiblingGroupFixture({
      patchVisibility: {
        measure: () => ({}),
        isVisible: () => true,
        estimate,
      },
    });
    fixture.componentRef.setInput('generationBudget', 1);
    for (let frame = 0; frame < 8; frame += 1) beforeRender$.next();

    expect(estimate).toHaveBeenCalled();
    // Root x=1's children are the visible group, though root x=0's are nearer.
    expect(generated.slice(0, 4).every((address) => address.x >= 2)).toBeTrue();
    expect(generated.slice(4).every((address) => address.x < 2)).toBeTrue();
    expect(generated.length).toBe(8);
    expect(scene.children[0].children.length).toBe(8);
    fixture.destroy();
  });

  it('keeps a whole sibling group at its distance priority when any member may be visible', () => {
    // Only one child of the farther group is visible; its three siblings follow it.
    const { fixture, generated } = createSiblingGroupFixture({
      patchVisibility: {
        measure: () => ({}),
        isVisible: () => true,
        estimate: (address: IPlaneTerrainPatchAddress) => address.x === 3 && address.z === 1,
      },
    });
    fixture.componentRef.setInput('generationBudget', 1);
    for (let frame = 0; frame < 8; frame += 1) beforeRender$.next();

    expect(generated.slice(0, 4).every((address) => address.x >= 2)).toBeTrue();
    expect(generated.slice(4).every((address) => address.x < 2)).toBeTrue();
    fixture.destroy();
  });

  it('ranks every patch replacing one resident together, across levels', () => {
    // Root x=1 is replaced by three children and four grandchildren; only one
    // grandchild may be visible, but the root can't be swapped out until all
    // seven are ready, so its level-1 children are not deferred either.
    const { fixture, generated } = createSiblingGroupFixture({
      maxLod: 2,
      patchSelector: ({
        domain,
        roots: selected,
      }: ITerrainSurfaceSelectionRequest<IPlaneTerrainPatchAddress>) =>
        selected.flatMap((root) =>
          domain
            .getChildren(root)
            .flatMap((child) =>
              child.x === 3 && child.z === 1 ? domain.getChildren(child) : [child],
            ),
        ),
      patchVisibility: {
        measure: () => ({}),
        isVisible: () => true,
        estimate: (address: IPlaneTerrainPatchAddress) =>
          address.level === 2 && address.x === 7 && address.z === 3,
      },
    });
    fixture.componentRef.setInput('generationBudget', 1);
    for (let frame = 0; frame < 11; frame += 1) beforeRender$.next();

    const underSecondRoot = (address: IPlaneTerrainPatchAddress) =>
      address.x >= 2 ** address.level;
    expect(generated.length).toBe(11);
    expect(generated.slice(0, 7).every(underSecondRoot)).toBeTrue();
    expect(generated.slice(7).some(underSecondRoot)).toBeFalse();
    fixture.destroy();
  });

  it('generates nearest first without an estimate', () => {
    const { fixture, generated } = createSiblingGroupFixture({
      patchVisibility: { measure: () => ({}), isVisible: () => true },
    });
    fixture.componentRef.setInput('generationBudget', 1);
    for (let frame = 0; frame < 4; frame += 1) beforeRender$.next();

    expect(generated.every((address) => address.x < 2)).toBeTrue();
    fixture.destroy();
  });

  it('installs at most maxInstallsPerFrame patches per update, but never splits a group', () => {
    const { fixture } = createSiblingGroupFixture({});
    fixture.componentRef.setInput('maxInstallsPerFrame', 1);
    fixture.detectChanges();
    const patchCount = () => scene.children[0].children.length;
    expect(patchCount()).toBe(2);

    // Everything is generated this frame, but only the nearest group of four
    // replaces its root: a cap of one still commits a whole group.
    beforeRender$.next();
    expect(patchCount()).toBe(5);

    // A still camera drains the remainder.
    beforeRender$.next();
    expect(patchCount()).toBe(8);
    beforeRender$.next();
    expect(patchCount()).toBe(8);
    fixture.destroy();
  });

  it('installs the finished groups nearest the camera first when capped', () => {
    const { fixture } = createSiblingGroupFixture({});
    fixture.componentRef.setInput('maxInstallsPerFrame', 4);
    fixture.detectChanges();
    beforeRender$.next();
    const installed = scene.children[0].children.map((child) => child.position.x);
    // Root x=1 is still resident (centre 1200 m); root x=0 was replaced.
    expect(installed.filter((x) => x > 800).length).toBe(1);
    expect(installed.length).toBe(5);
    fixture.destroy();
  });

  it('uses an opt-in patch selector while retaining shared mesh streaming', () => {
    const fixture = TestBed.createComponent(TerrainSurfaceComponent);
    const selector = jasmine
      .createSpy('patchSelector')
      .and.callFake(({ roots }: { roots: readonly unknown[] }) => roots);
    fixture.componentRef.setInput('field', new ConstantTerrainField(0));
    fixture.componentRef.setInput('domain', new PlaneTerrainDomain(800));
    fixture.componentRef.setInput('roots', [{ level: 0, x: 0, z: 0 }]);
    fixture.componentRef.setInput('maxLod', 2);
    fixture.componentRef.setInput('resolution', 4);
    fixture.componentRef.setInput('generationBudget', 100);
    fixture.componentRef.setInput('patchSelector', selector);
    fixture.detectChanges();

    beforeRender$.next();
    expect(selector).not.toHaveBeenCalled();

    beforeRender$.next();

    expect(selector).toHaveBeenCalledWith(
      jasmine.objectContaining({ maxLevel: 2 }),
    );
    expect(scene.children[0].children.length).toBe(1);
  });

  it('reports resident geometry bytes and skirt draw calls for performance diagnostics', () => {
    const fixture = TestBed.createComponent(TerrainSurfaceComponent);
    const stats: ITerrainSurfaceLodStats[] = [];
    fixture.componentInstance.lodChange.subscribe((value) => stats.push(value));
    fixture.componentRef.setInput('field', new ConstantTerrainField(0));
    fixture.componentRef.setInput('domain', new PlaneTerrainDomain(800));
    fixture.componentRef.setInput('roots', [{ level: 0, x: 0, z: 0 }]);
    fixture.componentRef.setInput('maxLod', 0);
    fixture.componentRef.setInput('resolution', 4);
    fixture.componentRef.setInput('skirtDepth', 10);
    fixture.componentRef.setInput('generationBudget', 1);
    fixture.detectChanges();

    beforeRender$.next();

    expect(stats.at(-1)).toEqual(
      jasmine.objectContaining({
        desired: 1,
        resident: 1,
        queued: 0,
        drawCalls: 2,
      }),
    );
    expect(stats.at(-1)!.geometryBytes).toBeGreaterThan(0);
  });

  function createSelectionFixture() {
    const fixture = TestBed.createComponent(TerrainSurfaceComponent);
    const selector = jasmine.createSpy('live selector').and.callFake(
      ({ roots }: ITerrainSurfaceSelectionRequest<IPlaneTerrainPatchAddress>) => roots,
    );
    const generator = jasmine.createSpy('generator').and.callFake(
      (request: ITerrainSurfaceGenerationRequest<IPlaneTerrainPatchAddress>) =>
        generateTerrainPatchMesh(request.field, request.domain, request),
    );
    fixture.componentRef.setInput('field', new ConstantTerrainField(0));
    fixture.componentRef.setInput('domain', new PlaneTerrainDomain(800));
    fixture.componentRef.setInput('roots', [{ level: 0, x: 0, z: 0 }]);
    fixture.componentRef.setInput('maxLod', 1);
    fixture.componentRef.setInput('resolution', 4);
    fixture.componentRef.setInput('generationBudget', 100);
    fixture.componentRef.setInput('patchSelector', selector);
    fixture.componentRef.setInput('meshGenerator', generator);
    fixture.detectChanges();
    beforeRender$.next();
    beforeRender$.next();
    selector.calls.reset();
    return { fixture, selector, generator };
  }

  it('reruns stationary selection on revision changes without regenerating unchanged residents', () => {
    const { fixture, selector, generator } = createSelectionFixture();
    const resident = scene.children[0].children[0];
    fixture.componentRef.setInput('selectionRevision', 'frustum-off');
    fixture.detectChanges();
    beforeRender$.next();
    expect(selector).toHaveBeenCalledTimes(1);
    expect(scene.children[0].children[0]).toBe(resident);
    expect(generator).toHaveBeenCalledTimes(1);
    beforeRender$.next();
    expect(selector).toHaveBeenCalledTimes(1);
    fixture.destroy();
  });

  it('reselects on small rotations even with an explicit LOD position', () => {
    const { fixture, selector } = createSelectionFixture();
    fixture.componentRef.setInput('lodPosition', [0, 100, 0]);
    fixture.detectChanges();
    beforeRender$.next();
    selector.calls.reset();
    camera.rotation.y += 0.0001;
    beforeRender$.next();
    expect(selector).toHaveBeenCalledTimes(1);
    fixture.destroy();
  });

  it('reselects when FOV, zoom, or aspect changes without camera movement', () => {
    const { fixture, selector } = createSelectionFixture();
    camera.fov = 30;
    camera.updateProjectionMatrix();
    beforeRender$.next();
    expect(selector).toHaveBeenCalledTimes(1);
    camera.zoom = 2;
    camera.updateProjectionMatrix();
    beforeRender$.next();
    expect(selector).toHaveBeenCalledTimes(2);
    camera.aspect = 2;
    camera.updateProjectionMatrix();
    beforeRender$.next();
    expect(selector).toHaveBeenCalledTimes(3);
    fixture.destroy();
  });

  it('defers revision changes while frozen and applies them on unfreeze', () => {
    const { fixture, selector, generator } = createSelectionFixture();
    const resident = scene.children[0].children[0];
    fixture.componentRef.setInput('freezeLod', true);
    fixture.componentRef.setInput('selectionRevision', 1);
    fixture.detectChanges();
    beforeRender$.next();
    expect(selector).not.toHaveBeenCalled();
    expect(scene.children[0].children[0]).toBe(resident);
    fixture.componentRef.setInput('freezeLod', false);
    fixture.detectChanges();
    beforeRender$.next();
    expect(selector).toHaveBeenCalledTimes(1);
    expect(generator).toHaveBeenCalledTimes(1);
    fixture.destroy();
  });
});
