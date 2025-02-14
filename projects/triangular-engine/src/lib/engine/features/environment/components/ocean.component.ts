import { Component, OnInit } from '@angular/core';
import {
  PlaneGeometry,
  ShaderMaterial,
  DoubleSide,
  Vector3,
  Color,
} from 'three';
import {
  MeshComponent,
  Object3DComponent,
  provideObject3DComponent,
} from '../../../components';
import { EngineService } from '../../../services';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

@Component({
  selector: 'ocean',
  standalone: true,
  template: `<ng-content></ng-content>`,
  providers: [provideObject3DComponent(OceanComponent)],
})
export class OceanComponent extends MeshComponent implements OnInit {}
