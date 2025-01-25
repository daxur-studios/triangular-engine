import {
  Component,
  Input,
  OnInit,
  signal,
  OnChanges,
  SimpleChanges,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { Euler, Object3D, Vector3 } from 'three';
import { EulerField, Field, Vector3Field } from '../../core';

@Component({
  selector: 'field-panel',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './field-panel.component.html',
  styleUrls: ['./field-panel.component.css'],
})
/** UI Component to allow user to change field values based on a selected Object3D */
export class FieldPanelComponent implements OnInit, OnChanges {
  @Input({ required: true }) object3D?: Object3D;
  fields: Field[] = [];

  constructor() {}

  ngOnInit(): void {}

  ngOnChanges(changes: SimpleChanges): void {
    if (this.object3D !== changes['object3D'].previousValue) {
      this.onObject3DChange(changes);
    }
  }

  onObject3DChange(changes: SimpleChanges) {
    const object3D = this.object3D!;

    const nameField = new Field(object3D, 'name');

    const positionField = new Vector3Field(object3D, 'position', (value) => {
      object3D.position.copy(value);
    });
    const rotationField = new EulerField(object3D, 'rotation', (value) => {
      object3D.rotation.copy(value);
    });
    const scaleField = new Vector3Field(object3D, 'scale', (value) => {
      object3D.scale.copy(value);
    });

    this.fields = [nameField, positionField, rotationField, scaleField];

    // Add all other fields
    for (const k in object3D) {
      const key = k as keyof Object3D;
      if (key === 'position' || key === 'rotation' || key === 'scale') {
        continue;
      }

      const filed = object3D[key];
      if (filed instanceof Field) {
        this.fields.push(filed);
      }
    }
  }

  setField(event: string | boolean, field: Field) {
    field.set(event);
  }
  setVector3Field(event: { x: string; y: string; z: string }, field: Field) {
    field.set(
      new Vector3(
        parseFloat(event.x),
        parseFloat(event.y),
        parseFloat(event.z),
      ),
    );
  }
  setEulerField(event: { x: string; y: string; z: string }, field: Field) {
    field.set(
      new Euler(parseFloat(event.x), parseFloat(event.y), parseFloat(event.z)),
    );
  }
}
