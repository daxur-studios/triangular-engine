import { Component, inject } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Scene } from 'three';
import { ENGINE_SCENE_TREE_COMPONENT } from '../../models';
import { EngineService } from '../../services';
import { EngineUiComponent } from './engine-ui.component';

@Component({
  selector: 'test-scene-tree',
  template: '<p class="test-scene-tree">{{ engine.scene.name }}</p>',
})
class SceneTreeFixtureComponent {
  readonly engine = inject(EngineService);
}

describe('EngineUiComponent optional Scene Tree', () => {
  function createUi(withAdapter: boolean, visible: boolean) {
    const scene = new Scene();
    scene.name = 'Current engine scene';
    TestBed.configureTestingModule({
      imports: [EngineUiComponent],
      providers: [
        { provide: EngineService, useValue: { scene, options: { showFPS: false } } },
        ...(withAdapter
          ? [{ provide: ENGINE_SCENE_TREE_COMPONENT, useValue: SceneTreeFixtureComponent }]
          : []),
      ],
    });
    const fixture = TestBed.createComponent(EngineUiComponent);
    fixture.componentRef.setInput('userInterface', { showSceneTree: visible });
    fixture.detectChanges();
    return fixture;
  }

  it('renders core UI without a panel adapter even when the visibility flag is set', () => {
    const fixture = createUi(false, true);
    expect(fixture.nativeElement.querySelector('.ui-sidebar-right')).not.toBeNull();
    expect(fixture.nativeElement.querySelector('.test-scene-tree')).toBeNull();
  });

  it('renders the opted-in panel using the owning scene injector', () => {
    const fixture = createUi(true, true);
    const panel: HTMLElement = fixture.nativeElement.querySelector('.test-scene-tree');
    expect(panel.textContent).toBe('Current engine scene');
  });

  it('destroys the opted-in panel when the visibility flag is switched off', () => {
    const fixture = createUi(true, true);
    expect(fixture.nativeElement.querySelector('.test-scene-tree')).not.toBeNull();
    fixture.componentRef.setInput('userInterface', { showSceneTree: false });
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.test-scene-tree')).toBeNull();
  });
});
