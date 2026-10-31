import { Component, effect, inject, input, output } from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { BufferAttribute, BufferGeometry, DoubleSide, Mesh, MeshStandardMaterial } from 'three';
import { BehaviorSubject, type Subscription } from 'rxjs';
import { GroupComponent, provideObject3DComponent } from 'triangular-engine';
import { LAYER_MOVING, wrapQuat, wrapVec3 } from '../example';
import { Jolt, JoltPhysicsService } from '../jolt-physics';

export interface IJoltSoftBodyCreatedEvent { readonly body: Jolt.Body; readonly owner: JoltSoftBodyComponent; readonly vertexCount: number; }
export type JoltSoftBodyBendType = 'none' | 'distance' | 'dihedral';

/**
 * Declaratively creates a mesh-backed Jolt soft body and keeps its vertices synchronized.
 *
 * The inputs mirror `Jolt.SoftBodyCreationSettings` so a page can reproduce the official
 * Jolt.js examples: pass `[updatePosition]="false"` and `[pressure]` for the cloth and
 * pressure-sphere examples, and leave `linearDamping` at 0.
 */
@Component({
  selector: 'joltSoftBody',
  imports: [],
  template: '',
  providers: [provideObject3DComponent(JoltSoftBodyComponent)],
})
export class JoltSoftBodyComponent extends GroupComponent {
  readonly service = inject(JoltPhysicsService);
  readonly vertices = input<ReadonlyArray<readonly [number, number, number]>>([]);
  readonly faces = input<ReadonlyArray<readonly [number, number, number]>>([]);
  readonly pinnedVertices = input<ReadonlyArray<number>>([]);
  /** Bend constraint model: `none`, `distance`, or `dihedral`. */
  readonly bendType = input<JoltSoftBodyBendType>('none');
  readonly solverIterations = input(5);
  /** Jolt's `mLinearDamping`; the official examples leave it at 0. */
  readonly linearDamping = input(0);
  readonly gravityFactor = input(1);
  /** Internal pressure multiplier for closed membranes such as balloons (`mPressure`). */
  readonly pressure = input(0);
  readonly velocity = input<readonly [number, number, number]>([0, 0, 0]);
  readonly edgeCompliance = input(0.0001);
  readonly shearCompliance = input(0.0001);
  readonly bendCompliance = input(0.001);
  /**
   * Jolt's `mUpdatePosition`. The official examples set it to `false`, which keeps the body
   * transform fixed and lets the vertices carry the motion in body space.
   */
  readonly updatePosition = input(true);
  readonly friction = input(0.5);
  readonly restitution = input(0);
  /** Jolt's `mVertexRadius`: collision thickness of each simulated particle. */
  readonly vertexRadius = input(0);
  readonly maxLinearVelocity = input<number | undefined>(undefined);
  readonly color = input(0x4fd6a8);
  readonly created = output<IJoltSoftBodyCreatedEvent>();

  /** The live body, once Jolt has created it. */
  readonly body$ = new BehaviorSubject<Jolt.Body | undefined>(undefined);
  readonly body = toSignal(this.body$);

  #body?: Jolt.Body;
  #mesh?: Mesh;
  #material?: MeshStandardMaterial;
  #settings?: Jolt.SoftBodySharedSettings;
  #creationSettings?: Jolt.SoftBodyCreationSettings;
  #subscription?: Subscription;

  constructor() {
    super();
    effect(() => {
      const vertices = this.vertices();
      const faces = this.faces();
      if (vertices.length === 0 || faces.length === 0 || this.#body) return;
      void this.#create(vertices, faces);
    });
  }

  async #create(vertices: ReadonlyArray<readonly [number, number, number]>, faces: ReadonlyArray<readonly [number, number, number]>): Promise<void> {
    const metadata = await this.service.metaDataPromise;
    if (this.destroyRef.destroyed || this.#body) return;

    const shared = new metadata.Jolt.SoftBodySharedSettings();
    const vertex = new metadata.Jolt.SoftBodySharedSettingsVertex();
    const pinned = new Set(this.pinnedVertices());
    for (let index = 0; index < vertices.length; index++) {
      const [x, y, z] = vertices[index];
      vertex.mPosition.x = x;
      vertex.mPosition.y = y;
      vertex.mPosition.z = z;
      vertex.mInvMass = pinned.has(index) ? 0 : 1;
      shared.mVertices.push_back(vertex);
    }
    metadata.Jolt.destroy(vertex);

    const face = new metadata.Jolt.SoftBodySharedSettingsFace(0, 0, 0, 0);
    for (const [a, b, c] of faces) {
      face.set_mVertex(0, a); face.set_mVertex(1, b); face.set_mVertex(2, c);
      shared.AddFace(face);
    }
    metadata.Jolt.destroy(face);
    shared.CalculateEdgeLengths();
    const attributes = new metadata.Jolt.SoftBodySharedSettingsVertexAttributes();
    attributes.mCompliance = this.edgeCompliance();
    attributes.mShearCompliance = this.shearCompliance();
    attributes.mBendCompliance = this.bendCompliance();
    const bendTypes = {
      none: metadata.Jolt.SoftBodySharedSettings_EBendType_None,
      distance: metadata.Jolt.SoftBodySharedSettings_EBendType_Distance,
      dihedral: metadata.Jolt.SoftBodySharedSettings_EBendType_Dihedral,
    } as const;
    shared.CreateConstraints(attributes, 1, bendTypes[this.bendType()]);
    metadata.Jolt.destroy(attributes);
    shared.Optimize();

    const bodyPosition = new metadata.Jolt.RVec3(...this.position());
    const bodyRotation = new metadata.Jolt.Quat(0, 0, 0, 1);
    const settings = new metadata.Jolt.SoftBodyCreationSettings(shared, bodyPosition, bodyRotation, LAYER_MOVING);
    settings.mNumIterations = this.solverIterations();
    settings.mLinearDamping = this.linearDamping();
    settings.mGravityFactor = this.gravityFactor();
    settings.mPressure = this.pressure();
    settings.mUpdatePosition = this.updatePosition();
    settings.mFriction = this.friction();
    settings.mRestitution = this.restitution();
    settings.mVertexRadius = this.vertexRadius();
    const maxLinearVelocity = this.maxLinearVelocity();
    if (maxLinearVelocity !== undefined) settings.mMaxLinearVelocity = maxLinearVelocity;
    // `CreateSoftBody` creates the body without adding it, so pair it with `AddBody` exactly
    // like the official Jolt.js examples do. (`CreateAndAddSoftBody` adds it but returns an id
    // that has to be resolved through the body lock interface, whose handle is unsafe to cache.)
    const body = metadata.bodyInterface.CreateSoftBody(settings);
    metadata.bodyInterface.AddBody(body.GetID(), metadata.Jolt.EActivation_Activate);
    metadata.Jolt.destroy(bodyPosition); metadata.Jolt.destroy(bodyRotation);
    if (this.destroyRef.destroyed) {
      metadata.bodyInterface.RemoveBody(body.GetID());
      metadata.bodyInterface.DestroyBody(body.GetID());
      metadata.Jolt.destroy(settings);
      return;
    }
    this.#body = body;
    this.#settings = shared;
    // The binding's `mSettings` does not add a reference, so destroying the creation settings
    // releases the shared settings. Keep both alive until the body is gone.
    this.#creationSettings = settings;

    const geometry = new BufferGeometry();
    const positionData = new Float32Array(vertices.length * 3);
    geometry.setAttribute('position', new BufferAttribute(positionData, 3));
    geometry.setIndex(faces.flatMap(([a, b, c]) => [a, b, c]));
    const material = new MeshStandardMaterial({ color: this.color(), side: DoubleSide, roughness: 0.55 });
    const mesh = new Mesh(geometry, material);
    // The vertices move inside the body; a bounds computed once at creation would cull it away.
    mesh.frustumCulled = false;
    this.#mesh = mesh;
    this.#material = material;
    this.object3D().add(mesh);
    this.#setParticleVelocity(metadata.Jolt, this.velocity());
    const motion = metadata.Jolt.castObject(body.GetMotionProperties(), metadata.Jolt.SoftBodyMotionProperties);
    motion.SetPressure(this.pressure());
    this.#syncVertices(metadata.Jolt);
    this.body$.next(body);
    this.#subscription = this.service.physicsUpdated$.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(() => this.#syncVertices(metadata.Jolt));
    this.created.emit({ body, owner: this, vertexCount: vertices.length });
  }

  #setParticleVelocity(jolt: typeof Jolt, velocity: readonly [number, number, number]): void {
    if (!this.#body) return;
    const motion = jolt.castObject(this.#body.GetMotionProperties(), jolt.SoftBodyMotionProperties);
    const vertices = motion.GetVertices();
    const offset = jolt.SoftBodyVertexTraits.prototype.mVelocityOffset;
    for (let i = 0; i < vertices.size(); i++) {
      const target = new Float32Array(jolt.HEAPF32.buffer, jolt.getPointer(vertices.at(i)) + offset, 3);
      target[0] = velocity[0]; target[1] = velocity[1]; target[2] = velocity[2];
    }
  }

  #syncVertices(jolt: typeof Jolt): void {
    const body = this.#body;
    const mesh = this.#mesh;
    if (!body || !mesh) return;
    this.object3D().position.copy(wrapVec3(body.GetPosition()));
    this.object3D().quaternion.copy(wrapQuat(body.GetRotation()));
    const motion = jolt.castObject(body.GetMotionProperties(), jolt.SoftBodyMotionProperties);
    const vertices = motion.GetVertices();
    const offset = jolt.SoftBodyVertexTraits.prototype.mPositionOffset;
    const attribute = mesh.geometry.getAttribute('position') as BufferAttribute;
    for (let i = 0; i < vertices.size(); i++) {
      const position = new Float32Array(jolt.HEAP32.buffer, jolt.getPointer(vertices.at(i)) + offset, 3);
      attribute.setXYZ(i, position[0], position[1], position[2]);
    }
    attribute.needsUpdate = true;
    mesh.geometry.computeVertexNormals();
  }

  override ngOnDestroy(): void {
    this.dispose();
    super.ngOnDestroy();
  }

  /** Removes the live Jolt body and its subscription; safe to call more than once. */
  dispose(): void {
    this.#subscription?.unsubscribe();
    this.#subscription = undefined;
    const body = this.#body;
    const metadata = this.service.metaData$.value;
    this.#body = undefined;
    if (body && metadata) {
      try {
        metadata.bodyInterface.RemoveBody(body.GetID());
        metadata.bodyInterface.DestroyBody(body.GetID());
      } catch (error) {
        console.warn('[JoltSoftBody] Could not destroy the soft body:', error);
      }
    }
    if (this.#settings && this.#creationSettings && metadata) {
      // Destroying the creation settings releases the shared settings it points at; do not
      // release `#settings` a second time.
      metadata.Jolt.destroy(this.#creationSettings);
      this.#creationSettings = undefined;
      this.#settings = undefined;
    } else if (this.#settings && metadata) {
      metadata.Jolt.destroy(this.#settings);
      this.#settings = undefined;
    }
    if (this.#mesh) {
      this.object3D().remove(this.#mesh);
      this.#mesh.geometry.dispose();
      this.#mesh = undefined;
    }
    this.#material?.dispose();
    this.#material = undefined;
    this.body$.next(undefined);
  }
}
