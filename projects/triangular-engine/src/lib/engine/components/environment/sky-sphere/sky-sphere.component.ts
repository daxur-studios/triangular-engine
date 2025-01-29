import { Component, effect, input, signal } from '@angular/core';
import { Color, Mesh, MeshBasicMaterial, SphereGeometry, Vector3Tuple } from 'three';
import { MeshComponent } from '../../mesh/mesh.component';
import { provideObject3DComponent } from '../../object-3d/object-3d.component';

import { SphereGeometryComponent } from '../../geometry/geometry.component';

@Component({
  selector: 'sky-sphere',
  standalone: true,
  imports: [SphereGeometryComponent],
  template: `
    <sphereGeometry [params]="sphereParams" />
    <ng-content></ng-content>
  `,
  providers: [provideObject3DComponent(SkySphereComponent)],
})
export class SkySphereComponent extends MeshComponent {
  // Day/night cycle value (0 = night, 1 = day)
  readonly dayNightCycle = input<number>(1);
  
  // Sky colors for day and night
  readonly dayColor = input<Vector3Tuple>([0.529, 0.808, 0.922]); // Light blue
  readonly nightColor = input<Vector3Tuple>([0.059, 0.059, 0.098]); // Dark blue
  
  // Sphere parameters
  readonly sphereParams = {
    radius: 1000, // Large radius to encompass the scene
    widthSegments: 32,
    heightSegments: 32,
  };

  // Material with custom color and opacity
  readonly skyMaterial = signal(
    new MeshBasicMaterial({
      color: new Color(),
      transparent: true,
      opacity: 1,
      side: 2, // BackSide to render inside of sphere
    })
  );

  constructor() {
    super();
    
    // Initialize material
    this.material.set(this.skyMaterial());
    
    // Update color and opacity based on day/night cycle
    effect(() => {
      const cycle = this.dayNightCycle();
      const dayColorRGB = this.dayColor();
      const nightColorRGB = this.nightColor();
      
      // Interpolate between night and day colors
      const color = new Color();
      color.r = nightColorRGB[0] + (dayColorRGB[0] - nightColorRGB[0]) * cycle;
      color.g = nightColorRGB[1] + (dayColorRGB[1] - nightColorRGB[1]) * cycle;
      color.b = nightColorRGB[2] + (dayColorRGB[2] - nightColorRGB[2]) * cycle;
      
      // Update material
      const material = this.skyMaterial();
      material.color = color;
      
      // Adjust opacity (more transparent at night)
      material.opacity = 0.3 + (cycle * 0.7); // Range from 0.3 to 1.0
      material.needsUpdate = true;
    });
  }
}
