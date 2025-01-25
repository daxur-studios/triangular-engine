// Import necessary classes from Three.js
import { Camera, Quaternion, Spherical, Vector2, Vector3, Event } from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

interface HiddenOrbitControlsProps {
  _v?: Vector3;
  _spherical?: Spherical;
  _quat?: Quaternion;
  _quatInverse?: Quaternion;
  _lastPosition?: Vector3;
  _lastQuaternion?: Quaternion;
  _lastTargetPosition?: Vector3;
}

/**
 * AdvancedOrbitControls extends the functionality of OrbitControls by allowing dynamic
 * adjustment of the up vector.
 */
class AdvancedOrbitControls extends OrbitControls {
  // Additional property to store the up vector
  private upVector: Vector3;

  /**
   * Creates an instance of AdvancedOrbitControls.
   * @param object - The camera to control.
   * @param domElement - The HTML element used for event listeners. Defaults to the document.
   */
  constructor(object: Camera, domElement: HTMLElement | null = null) {
    super(object, domElement || document.body);

    // Initialize with the current up vector
    this.upVector = object.up.clone();
  }

  /**
   * Dynamically sets a new up vector for the controls.
   * @param newUp - The new up vector to set.
   */
  setUpVector(newUp: Vector3): void {
    if (!(newUp instanceof Vector3)) {
      console.error('newUp must be an instance of THREE.Vector3');
      return;
    }

    // Normalize the new up vector
    newUp.normalize();

    // Update the object's up vector
    this.object.up.copy(newUp);
    this.upVector.copy(newUp);

    // Accessing protected/private properties via type assertion
    const controls = this as HiddenOrbitControlsProps;

    //  console.warn('controls', controls);

    // Recompute the internal quaternions to align the new up vector with Y-axis
    controls._quat?.setFromUnitVectors(this.upVector, new Vector3(0, 1, 0));
    controls._quatInverse?.copy(controls._quat!).invert();

    // Recompute the spherical coordinates based on the new up vector
    const position = this.object.position.clone();
    controls._v?.copy(position).sub(this.target);
    controls._v?.applyQuaternion(controls._quat!);
    if (controls._v) {
      controls._spherical?.setFromVector3(controls._v);
    }

    // Update last position and target to ensure consistency
    controls._lastPosition?.copy(this.object.position);
    controls._lastQuaternion?.copy(this.object.quaternion);
    controls._lastTargetPosition?.copy(this.target);

    // Dispatch a change event to notify listeners of the update
    this.dispatchEvent({ type: 'change' });
  }

  /**
   * Gets the current up vector.
   * @returns The current up vector.
   */
  getUpVector(): Vector3 {
    return this.upVector.clone();
  }

  /**
   * Overrides the update method to include any additional logic if necessary.
   * @param deltaTime - Optional delta time parameter.
   * @returns A boolean indicating if the controls were updated.
   */
  override update(deltaTime: number | null = null): boolean {
    // Call the parent update method
    const updated = super.update(deltaTime);

    // Additional logic can be added here if needed

    return updated;
  }
}

export { AdvancedOrbitControls };
