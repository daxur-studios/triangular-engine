import { Component } from '@angular/core';

/**
 * Wraps your 3D scene components in a physics world.
 *
 * Initializes the Rapier physics engine and provides a simulation step on every frame.
 *
 * All physics-enabled components (like <rigidBody>, <collider>, etc.) inside this tag will interact with each other based on physics rules.
 */
@Component({
  selector: 'physics',
  standalone: true,
  imports: [],
  templateUrl: './physics.component.html',
  styleUrl: './physics.component.css',
})
export class PhysicsComponent {}
