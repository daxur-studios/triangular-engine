import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Scene, Vector3Tuple } from 'three';
import { EngineFramePhase } from '../../models';
import { EngineService } from '../../services';
import { GroupComponent } from './group.component';

@Component({
  imports: [GroupComponent],
  template: `<group [name]="'probe'" [position]="position()" />`,
})
class HostComponent {
  readonly position = signal<Vector3Tuple>([0, 0, 0]);
}

describe('Object3DComponent late scene-write report', () => {
  let engine: {
    scene: Scene;
    framePhase: EngineFramePhase;
    reportLateSceneWrite: jasmine.Spy;
  };

  function apply(
    fixture: ComponentFixture<HostComponent>,
    position: Vector3Tuple,
    phase: EngineFramePhase,
  ): void {
    engine.framePhase = phase;
    fixture.componentInstance.position.set(position);
    fixture.detectChanges();
  }

  beforeEach(() => {
    engine = {
      scene: new Scene(),
      framePhase: 'idle',
      reportLateSceneWrite: jasmine.createSpy('reportLateSceneWrite'),
    };
    TestBed.configureTestingModule({
      imports: [HostComponent],
      providers: [{ provide: EngineService, useValue: engine }],
    });
  });

  it('reports a transform applied in the late check, not one applied in the sync or at creation', () => {
    engine.framePhase = 'lateCheck';
    const fixture = TestBed.createComponent(HostComponent);
    fixture.detectChanges();
    expect(engine.reportLateSceneWrite).not.toHaveBeenCalled();

    apply(fixture, [1, 0, 0], 'sync');
    expect(engine.reportLateSceneWrite).not.toHaveBeenCalled();

    apply(fixture, [2, 0, 0], 'lateCheck');
    expect(engine.reportLateSceneWrite).toHaveBeenCalledOnceWith('probe', 'position');
  });

  it('ignores changes applied between frames (input events, async work)', () => {
    const fixture = TestBed.createComponent(HostComponent);
    fixture.detectChanges();
    apply(fixture, [3, 0, 0], 'idle');
    expect(engine.reportLateSceneWrite).not.toHaveBeenCalled();
  });
});
