import { Component } from '@angular/core';

@Component({
  selector: 'canvasTarget',
  imports: [],
  templateUrl: './canvas-target.component.html',
  styleUrl: './canvas-target.component.css',
})
export class CanvasTargetComponent {
  constructor() {
    this.#init();
  }

  #init() {}
}
