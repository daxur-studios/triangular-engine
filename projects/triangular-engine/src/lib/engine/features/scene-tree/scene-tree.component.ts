import { Component, inject, OnDestroy, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatMenuModule } from '@angular/material/menu';
import { EngineService } from '../../services';
import { Object3D, Vector3, Euler } from 'three';
import {
  TransformControls,
  TransformControlsMode,
} from 'three/examples/jsm/controls/TransformControls.js';
import { Subscription } from 'rxjs';
import { Object3DComponent } from '../../components';

// Node for the scene tree
interface SceneNode {
  id: string;
  name: string;
  object: Object3D;
  children: SceneNode[];
  emoji?: string;
  expanded?: boolean;
  level: number;
}

@Component({
  selector: 'sceneTree',
  standalone: true,
  imports: [CommonModule, FormsModule, MatMenuModule],
  templateUrl: './scene-tree.component.html',
  styleUrl: './scene-tree.component.css',
})
export class SceneTreeComponent implements OnInit, OnDestroy {
  readonly engineService = inject(EngineService);

  // Tree data
  treeData: SceneNode[] = [];

  // Map to store expanded state of nodes
  private expandedNodes = new Map<string, boolean>();

  // Selected object and transform mode
  selectedObject = signal<Object3D | null>(null);
  transformMode = signal<TransformControlsMode>('translate');

  // Transform controls reference
  private transformControls: TransformControls | null = null;

  // Subscriptions
  private subscriptions: Subscription[] = [];

  // Refresh interval
  private refreshInterval: any;

  // Transform values for the selected object
  position = signal<Vector3>(new Vector3());
  rotation = signal<Euler>(new Euler());
  scale = signal<Vector3>(new Vector3(1, 1, 1));

  // Scene tree visibility state
  isTreeVisible = signal<boolean>(true);

  // Make Math available in the template
  protected readonly Math = Math;

  constructor() {
    // Load tree visibility preference from local storage
    const savedVisibility = localStorage.getItem('sceneTreeVisible');
    if (savedVisibility !== null) {
      this.isTreeVisible.set(savedVisibility === 'true');
    }
  }

  ngOnInit() {
    // Build the initial tree
    this.refreshTree();

    // Set up a timer to refresh the tree periodically - use a longer interval to avoid interfering with user interactions
    this.refreshInterval = setInterval(() => this.refreshTree(), 3000);

    // Subscribe to isDraggingTransformControls$ to know when transform controls are being used
    this.subscriptions.push(
      this.engineService.isDraggingTransformControls$.subscribe(
        (isDragging) => {
          // You can add additional logic here if needed when dragging state changes
        },
      ),
    );

    // Subscribe to camera changes
    this.subscriptions.push(
      this.engineService.camera$.subscribe(() => {
        // If we have an active object selected, reapply transform controls with the new camera
        if (this.selectedObject()) {
          this.applyTransformControls();
        }
      }),
    );
  }

  ngOnDestroy() {
    // Clear the refresh interval
    if (this.refreshInterval) {
      clearInterval(this.refreshInterval);
    }

    // Unsubscribe from all subscriptions
    this.subscriptions.forEach((sub) => sub.unsubscribe());

    // Remove transform controls if they exist
    this.removeTransformControls();

    // Clear selection
    this.selectedObject.set(null);
  }

  refreshTree() {
    // Save the current expanded state before refreshing
    this.saveExpandedState(this.treeData);

    // Clear and rebuild the tree
    this.treeData = [];
    this.buildTreeFromScene(this.engineService.scene, this.treeData, 0);
  }

  // Save the expanded state of all nodes
  private saveExpandedState(nodes: SceneNode[]) {
    nodes.forEach((node) => {
      this.expandedNodes.set(node.id, !!node.expanded);
      if (node.children && node.children.length > 0) {
        this.saveExpandedState(node.children);
      }
    });
  }

  private buildTreeFromScene(
    object: Object3D,
    nodes: SceneNode[],
    level: number,
  ) {
    const node: SceneNode = {
      id: object.uuid,
      name: object.name || object.type,
      object: object,
      children: [],
      emoji: this.getEmojiForObject(object),
      level: level,
    };

    // Restore expanded state from our map, or use default (expand first level)
    if (this.expandedNodes.has(node.id)) {
      node.expanded = this.expandedNodes.get(node.id);
    } else {
      node.expanded = level === 0; // Expand only the first level by default
    }

    nodes.push(node);

    // Process children
    if (object.children && object.children.length > 0) {
      object.children.forEach((child) => {
        this.buildTreeFromScene(child, node.children, level + 1);
      });
    }
  }

  private getEmojiForObject(object: Object3D): string {
    // Try to get emoji from the component if available
    const emoji = (object as any).emoji;
    if (emoji) return emoji;

    // Default emojis based on object type
    switch (object.type) {
      case 'Scene':
        return '🌍';
      case 'Mesh':
        return '🧊';
      case 'Group':
        return '📦';
      case 'PerspectiveCamera':
        return '📷';
      case 'DirectionalLight':
        return '💡';
      case 'AmbientLight':
        return '🔆';
      case 'PointLight':
        return '💫';
      case 'GridHelper':
        return '📏';
      case 'SkinnedMesh':
        return '🦴';
      default:
        return '🔹';
    }
  }

  toggleNode(node: SceneNode, event: Event) {
    event.stopPropagation();
    node.expanded = !node.expanded;

    // Update our expanded nodes map
    this.expandedNodes.set(node.id, node.expanded);
  }

  selectObject(node: SceneNode, event: Event) {
    event.stopPropagation();

    // If clicking the same object, deselect it
    if (this.selectedObject() === node.object) {
      this.selectedObject.set(null);
      this.removeTransformControls();
      this.resetTransformValues();
    } else {
      this.selectedObject.set(node.object);
      this.updateTransformValues(node.object);
      this.applyTransformControls();
    }
  }

  setTransformMode(mode: TransformControlsMode, event: Event) {
    event.stopPropagation();
    this.transformMode.set(mode);

    // Only reapply if we have a selected object
    if (this.selectedObject()) {
      this.applyTransformControls();
    }
  }

  private removeTransformControls() {
    // Remove any existing transform controls
    if (this.transformControls) {
      this.transformControls.detach();
      this.engineService.scene.remove(this.transformControls.getHelper());
      this.transformControls.dispose();
      this.transformControls = null;
    }

    this.engineService.isDraggingTransformControls$.next(false);
  }

  private applyTransformControls() {
    // Remove any existing transform controls
    this.removeTransformControls();

    const selectedObj = this.selectedObject();
    if (!selectedObj) return;

    try {
      // Create and attach transform controls
      this.transformControls = new TransformControls(
        this.engineService.camera,
        this.engineService.renderer.domElement,
      );

      // Then attach the selected object
      this.transformControls.attach(selectedObj);
      this.transformControls.setMode(this.transformMode());

      this.engineService.scene.add(this.transformControls.getHelper());

      // Handle dragging state to disable orbit controls while dragging
      this.transformControls.addEventListener(
        'dragging-changed',
        (event: any) => {
          this.engineService.isDraggingTransformControls$.next(event.value);
        },
      );

      // Log for debugging
      console.log('Transform controls added to scene', {
        mode: this.transformMode(),
        object: selectedObj.name || selectedObj.type,
      });

      // Add change event listener to update our transform values
      if (this.transformControls) {
        this.transformControls.addEventListener('objectChange', () => {
          const obj = this.selectedObject();
          if (obj) {
            this.updateTransformValues(obj);
          }
        });
      }
    } catch (error) {
      console.error('Error applying transform controls:', error);
    }
  }

  private resetTransformValues() {
    this.position.set(new Vector3());
    this.rotation.set(new Euler());
    this.scale.set(new Vector3(1, 1, 1));
  }

  private updateTransformValues(object: Object3D) {
    this.position.set(object.position.clone());
    this.rotation.set(object.rotation.clone());
    this.scale.set(object.scale.clone());
  }

  onPositionChange(axis: 'x' | 'y' | 'z', value: number) {
    const obj = this.selectedObject();
    if (!obj) return;

    obj.position[axis] = value;
    this.position.set(obj.position.clone());
    this.engineService.requestSingleRender();

    const object3DComponent = obj.userData['object3DComponent'] as
      | Object3DComponent
      | undefined;
    if (object3DComponent) {
      object3DComponent.position.set(obj.position.toArray());
    }
  }

  onRotationChange(axis: 'x' | 'y' | 'z', value: number) {
    const obj = this.selectedObject();
    if (!obj) return;

    obj.rotation[axis] = (value * Math.PI) / 180; // Convert to radians
    this.rotation.set(obj.rotation.clone());
    this.engineService.requestSingleRender();

    const object3DComponent = obj.userData['object3DComponent'] as
      | Object3DComponent
      | undefined;
    if (object3DComponent) {
      object3DComponent.rotation.set(obj.rotation.toArray());
    }
  }

  onScaleChange(axis: 'x' | 'y' | 'z', value: number) {
    const obj = this.selectedObject();
    if (!obj) return;

    obj.scale[axis] = value;
    this.scale.set(obj.scale.clone());
    this.engineService.requestSingleRender();

    const object3DComponent = obj.userData['object3DComponent'] as
      | Object3DComponent
      | undefined;
    if (object3DComponent) {
      object3DComponent.scale.set(obj.scale.toArray());
    }
  }

  // Helper method to track nodes by ID for better performance
  trackByFn(index: number, node: SceneNode): string {
    return node.id;
  }

  toggleTreeVisibility() {
    const newValue = !this.isTreeVisible();
    this.isTreeVisible.set(newValue);
    localStorage.setItem('sceneTreeVisible', String(newValue));
  }

  getWorldPosition(): Vector3 {
    const obj = this.selectedObject();
    if (!obj) return new Vector3();

    const worldPosition = new Vector3();
    obj.getWorldPosition(worldPosition);
    return worldPosition;
  }

  copyTransformValues(
    values: Vector3 | Euler,
    type: 'position' | 'rotation' | 'scale' | 'world position',
  ) {
    if (!values) return;

    const text = `${values.x.toFixed(3)}, ${values.y.toFixed(3)}, ${values.z.toFixed(3)}`;
    navigator.clipboard.writeText(text);
  }
}
