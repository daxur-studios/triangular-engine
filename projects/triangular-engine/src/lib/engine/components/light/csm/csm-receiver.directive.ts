import { Directive, ElementRef, Input, OnDestroy, OnInit, inject } from '@angular/core';
import { Mesh, Object3D } from 'three';
import { CsmComponent } from './csm.component';

/**
 * Directive applied to `<mesh>` or 3D objects to control CSM receiver registration:
 *
 * Usage:
 * ```html
 * <!-- Explicitly opt out of cascaded shadows -->
 * <mesh [csmReceiver]="false">...</mesh>
 *
 * <!-- Explicitly register a mesh even if autoRegisterMaterials is false -->
 * <mesh [csmReceiver]="true">...</mesh>
 * ```
 */
@Directive({
  selector: '[csmReceiver]',
  standalone: true,
})
export class CsmReceiverDirective implements OnInit, OnDestroy {
  private readonly elementRef = inject(ElementRef, { optional: true });
  private readonly csm = inject(CsmComponent, { optional: true });

  @Input('csmReceiver')
  set csmReceiver(value: boolean | string | null | undefined) {
    this._enabled = value !== false && (value as any) !== 'false';
    this.updateTarget();
  }
  get csmReceiver(): boolean {
    return this._enabled;
  }
  private _enabled = true;

  private targetObject: Object3D | null = null;

  ngOnInit(): void {
    this.resolveTarget();
    this.updateTarget();
  }

  ngOnDestroy(): void {
    if (this.targetObject) {
      if (this.csm && this._enabled) {
        this.csm.unregisterObject(this.targetObject);
      }
      delete this.targetObject.userData['csmReceiver'];
    }
  }

  private resolveTarget(): void {
    if (this.elementRef?.nativeElement instanceof Object3D) {
      this.targetObject = this.elementRef.nativeElement;
    }
  }

  private updateTarget(): void {
    if (!this.targetObject) {
      this.resolveTarget();
    }
    if (this.targetObject) {
      this.targetObject.userData['csmReceiver'] = this._enabled;
      if (this.csm) {
        if (this._enabled) {
          this.csm.registerObject(this.targetObject);
        } else {
          this.csm.unregisterObject(this.targetObject);
        }
      }
    }
  }
}
