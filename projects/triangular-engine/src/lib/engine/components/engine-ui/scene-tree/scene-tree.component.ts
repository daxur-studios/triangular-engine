import { CommonModule } from '@angular/common';
import { Component, OnInit, OnDestroy, inject } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { Object3DComponent } from '../../object-3d';
import { EngineService } from '../../services';
import { Subject, takeUntil } from 'rxjs';
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js';
import { FieldPanelComponent } from './field-panel/field-panel.component';

@Component({
  selector: 'scene-tree',
  standalone: true,
  imports: [CommonModule, FieldPanelComponent, MatButtonModule, MatIconModule],
  templateUrl: './scene-tree.component.html',
  styleUrls: ['./scene-tree.component.scss'],
})
export class SceneTreeComponent implements OnInit, OnDestroy {
  //#region Injected Dependencies
  readonly engineService = inject(EngineService);
  //#endregion

  onDestroy$ = new Subject<void>();

  selectedObject3D?: Object3DComponent;
  transformControls: TransformControls | undefined;

  get orbitControls() {
    return this.engineService.orbitControls;
  }

  get scene() {
    return this.engineService.scene;
  }

  readonly children = this.engineService.getEngineComponent()!.children;

  constructor() {}

  ngOnInit(): void {}
  ngOnDestroy(): void {
    this.onDestroy$.next();
    this.onDestroy$.complete();
  }

  selectObject3D(object3D: Object3DComponent | undefined) {
    if (object3D instanceof TransformControls) {
      return;
    }

    this.selectedObject3D = object3D;

    if (this.selectedObject3D) {
      this.transformControls ||= new TransformControls(
        this.engineService.camera,
        this.engineService.renderer!.domElement
      );
      this.transformControls.name = 'TransformControls';
      this.transformControls.attach(this.selectedObject3D.object3D());

      this.transformControls.addEventListener('dragging-changed', (event) => {
        if (this.orbitControls) {
          this.orbitControls.enabled = !event.value;
        }
      });

      this.scene!.add(this.transformControls);
    } else {
      this.transformControls?.detach();
      this.scene!.remove(this.transformControls!);
      this.transformControls = undefined;
    }
  }

  refresh() {
    console.debug('refresh', this.scene);
    this.selectObject3D(undefined);
  }
}
