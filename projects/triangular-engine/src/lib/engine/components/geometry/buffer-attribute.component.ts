import { Component, effect, inject, input, OnDestroy } from '@angular/core';
import { BufferGeometryComponent } from './geometry.component';
import {
  BufferAttribute,
  NormalBufferAttributes,
  StaticDrawUsage,
  TypedArray,
  Usage,
} from 'three';

type AttributeName = 'position' | 'normal' | 'uv' | 'color' | 'index';

/**
Understanding BufferAttribute
A BufferAttribute in Three.js is essentially a way to store data (like positions, normals, colors, etc.) in a format that WebGL can efficiently use. It represents an array of data used to construct your geometry.

Common attribute names include:

- position: The positions of the vertices.
- normal: The normals at each vertex.
- uv: Texture coordinates.
- color: Vertex colors.
- index: Indices for indexed geometries.
*/
@Component({
  selector: 'bufferAttribute',
  template: `<ng-content></ng-content>`,
  standalone: true,
  imports: [],
  providers: [],
})
export class BufferAttributeComponent implements OnDestroy {
  readonly parent = inject(BufferGeometryComponent);

  // Input properties
  readonly attributeName = input.required<string>(); // e.g., 'position', 'normal', 'uv', 'color', 'index'
  readonly array = input.required<number[] | TypedArray>();
  readonly itemSize = input.required<number>();
  readonly normalized = input<boolean>(); // default false
  readonly usage = input<Usage>(); // BufferUsage enum

  emoji = '🔯';

  constructor() {
    effect(() => {
      const geometry = this.parent.geometry();
      if (geometry) {
        let data = this.array();
        // Convert number[] to TypedArray if necessary
        if (Array.isArray(data)) {
          if (this.attributeName() === 'index') {
            data = new Uint16Array(data);
          } else {
            data = new Float32Array(data);
          }
        }
        const bufferAttribute = new BufferAttribute(
          data,
          this.itemSize(),
          this.normalized() || false,
        );

        bufferAttribute.usage = this.usage() || StaticDrawUsage;

        if (this.attributeName() === 'index') {
          geometry.setIndex(bufferAttribute);
        } else {
          geometry.setAttribute(this.attributeName(), bufferAttribute);
        }
      }
    });
  }

  ngOnDestroy(): void {
    const geometry = this.parent.geometry();
    if (geometry) {
      if (this.attributeName() === 'index') {
        geometry.setIndex(null);
      } else {
        geometry.deleteAttribute(this.attributeName());
      }
    }
  }
}
