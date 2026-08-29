import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Subject } from 'rxjs';
import { Group, PerspectiveCamera, Scene } from 'three';
import { EngineService, Object3DComponent, provideObject3DComponent } from 'triangular-engine';
import { HOME_PLANET } from 'triangular-engine/celestial';
import { CdlodPlanetComponent } from './cdlod-planet.component';
import { BASE_PLACEMENT_TERRAIN_FLAG, TERRAIN_GEOMETRY_FLAG } from './cdlod-patch-mesher';

@Component({
  selector: 'test-parent-group',
  standalone: true,
  template: `<ng-content />`,
  providers: [provideObject3DComponent(TestParentGroupComponent)],
})
class TestParentGroupComponent extends Object3DComponent {
  override readonly object3D = signal(new Group());
}

@Component({
  selector: 'test-host',
  standalone: true,
  imports: [TestParentGroupComponent, CdlodPlanetComponent],
  template: `
    <test-parent-group [position]="[100, 200, 300]">
      <cdlodPlanet [body]="body" [useWorkers]="false" />
    </test-parent-group>
  `,
})
class TestHostComponent {
  body = HOME_PLANET;
}

describe('CdlodPlanetComponent', () => {
  let scene: Scene;
  let camera: PerspectiveCamera;
  let postTick$: Subject<number>;

  beforeEach(() => {
    scene = new Scene();
    camera = new PerspectiveCamera();
    postTick$ = new Subject<number>();
    TestBed.configureTestingModule({
      imports: [CdlodPlanetComponent, TestParentGroupComponent, TestHostComponent],
      providers: [
        {
          provide: EngineService,
          useValue: { scene, camera, postTick$ },
        },
      ],
    });
  });

  it('is a GroupComponent and exposes position, rotation, quaternion, and scale signals', () => {
    const fixture = TestBed.createComponent(CdlodPlanetComponent);
    fixture.componentRef.setInput('body', HOME_PLANET);
    fixture.componentRef.setInput('position', [1000, 2000, 3000]);
    fixture.componentRef.setInput('quaternion', [0, Math.SQRT1_2, 0, Math.SQRT1_2]);
    fixture.componentRef.setInput('scale', 2);
    fixture.componentRef.setInput('useWorkers', false);
    fixture.detectChanges();

    expect(scene.children.length).toBe(1);
    const root = scene.children[0];
    expect(root.position.x).toBe(1000);
    expect(root.position.y).toBe(2000);
    expect(root.position.z).toBe(3000);
    expect(root.quaternion.y).toBeCloseTo(0.7071, 4);
    expect(root.scale.x).toBe(2);
    expect(root.scale.y).toBe(2);
    expect(root.scale.z).toBe(2);

    fixture.destroy();
    expect(scene.children.length).toBe(0);
  });

  it('attaches to parent Object3DComponent automatically when nested in template', () => {
    const fixture = TestBed.createComponent(TestHostComponent);
    fixture.detectChanges();

    expect(scene.children.length).toBe(1);
    const parentGroup = scene.children[0];
    expect(parentGroup.position.x).toBe(100);
    expect(parentGroup.position.y).toBe(200);
    expect(parentGroup.position.z).toBe(300);

    // Child CdlodPlanetComponent should be attached inside parentGroup
    expect(parentGroup.children.length).toBe(1);
    const childRoot = parentGroup.children[0];
    expect(childRoot).toBeDefined();

    fixture.destroy();
    expect(scene.children.length).toBe(0);
  });

  it('generates CDLOD geometry marked with both terrain flags', () => {
    const fixture = TestBed.createComponent(CdlodPlanetComponent);
    fixture.componentRef.setInput('body', HOME_PLANET);
    fixture.componentRef.setInput('useWorkers', false);
    camera.position.set(0, 0, HOME_PLANET.radiusM + 1000);
    fixture.detectChanges();

    postTick$.next(16);

    expect(scene.children.length).toBe(1);
    const root = scene.children[0] as Group;
    expect(root).toBeDefined();

    // Check terrain meshes
    const terrainGroup = root.children[0] as Group;
    expect(terrainGroup.children.length).toBeGreaterThan(0);

    const firstMesh = terrainGroup.children[0] as any;
    expect(firstMesh.geometry.userData[TERRAIN_GEOMETRY_FLAG]).toBe(true);
    expect(firstMesh.geometry.userData[BASE_PLACEMENT_TERRAIN_FLAG]).toBe(true);

    fixture.destroy();
  });
});
