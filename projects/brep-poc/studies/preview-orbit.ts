import { Vector3, type OrthographicCamera } from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

interface OrbitView {
  canvas: HTMLCanvasElement;
  camera: OrthographicCamera;
  draw: () => void;
}

/** Keep comparison panels on a shared orbit. Angle buttons restore the original framing. */
export function linkPreviewOrbit(
  views: readonly OrbitView[], target: Vector3, buttons: readonly HTMLButtonElement[], angleDirection = 1,
): void {
  const frontOffset = views[0].camera.position.clone().sub(target);
  const vertical = new Vector3(0, 1, 0);
  const panels = views.map(view => {
    view.canvas.setAttribute('aria-describedby', 'orbit-hint');
    const controls = new OrbitControls(view.camera, view.canvas);
    controls.target.copy(target);
    controls.enablePan = false;
    controls.minZoom = .65;
    controls.maxZoom = 2.5;
    controls.minPolarAngle = .14;
    controls.maxPolarAngle = Math.PI - .14;
    controls.rotateSpeed = .7;
    controls.update();
    return { ...view, controls };
  });

  let synchronizing = false;
  for (const panel of panels) {
    panel.controls.addEventListener('change', () => {
      if (synchronizing) return;
      synchronizing = true;
      for (const other of panels) {
        if (other !== panel) {
          other.camera.position.copy(panel.camera.position);
          other.camera.zoom = panel.camera.zoom;
          other.camera.updateProjectionMatrix();
          other.controls.update();
        }
        other.draw();
      }
      buttons.forEach(button => button.setAttribute('aria-pressed', 'false'));
      synchronizing = false;
    });
  }

  for (const button of buttons) {
    button.disabled = false;
    button.addEventListener('click', () => {
      const radians = angleDirection * Number(button.dataset['angle']) * Math.PI / 180;
      synchronizing = true;
      for (const panel of panels) {
        panel.camera.position.copy(frontOffset).applyAxisAngle(vertical, radians).add(target);
        panel.camera.zoom = 1;
        panel.camera.updateProjectionMatrix();
        panel.controls.update();
        panel.draw();
      }
      buttons.forEach(choice => choice.setAttribute('aria-pressed', String(choice === button)));
      synchronizing = false;
    });
  }
  buttons.find(button => button.getAttribute('aria-pressed') === 'true')?.click();
}
