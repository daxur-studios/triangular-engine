// import { Component, effect, input, signal } from '@angular/core';
// import { Sky } from 'three/examples/jsm/Addons.js';
// import { Object3DComponent, provideObject3DComponent } from '../../components';
// import { Vector3 } from 'three';

// @Component({
//   selector: 'sky',
//   standalone: true,
//   template: `<ng-content></ng-content>`,
//   providers: [provideObject3DComponent(SkySphereComponent)],
// })
// export class SkySphereComponent extends Object3DComponent {
//   // Sky parameters
//   /** Atmospheric turbidity (2-21) */
//   readonly turbidity = input<number>(10);
//   /** Rayleigh scattering constant (0-4) */
//   readonly rayleigh = input<number>(3);
//   /** Mie scattering coefficient (0-0.1) */
//   readonly mieCoefficient = input<number>(0.005);
//   /** Mie directional scattering factor (0-1) */
//   readonly mieDirectionalG = input<number>(0.7);
//   /** Sun elevation (0-90) */
//   readonly elevation = input<number>(2);
//   /** Sun azimuth (0-360) */
//   readonly azimuth = input<number>(180);
//   /** Scene exposure (0-1) */
//   readonly exposure = input<number>(0.25);

//   readonly sky = signal(new Sky());
//   override readonly object3D = this.sky;

//   constructor() {
//     super();

//     // Initialize sky material uniforms
//     effect(() => {
//       const uniforms = this.sky().material.uniforms;

//       uniforms['turbidity'].value = this.turbidity();
//       uniforms['rayleigh'].value = this.rayleigh();
//       uniforms['mieCoefficient'].value = this.mieCoefficient();
//       uniforms['mieDirectionalG'].value = this.mieDirectionalG();

//       // Calculate sun position based on elevation and azimuth
//       const phi = ((90 - this.elevation()) * Math.PI) / 180;
//       const theta = (this.azimuth() * Math.PI) / 180;

//       const sunPosition = new Vector3();
//       sunPosition.setFromSphericalCoords(1, phi, theta);
//       uniforms['sunPosition'].value.copy(sunPosition);

//       // Update exposure
//       if (this.engineService.renderer) {
//         this.engineService.renderer.toneMappingExposure = this.exposure();
//       }
//     });
//   }
// }
