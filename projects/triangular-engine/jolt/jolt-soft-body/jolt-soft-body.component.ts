import { Component, effect, inject, input, output } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { BufferAttribute, BufferGeometry, DoubleSide, Mesh, MeshStandardMaterial } from 'three';
import { GroupComponent, provideObject3DComponent } from 'triangular-engine';
import { LAYER_MOVING, wrapVec3 } from '../example';
import { Jolt, JoltPhysicsComponent, JoltPhysicsService } from '../jolt-physics';

export interface IJoltSoftBodyCreatedEvent { readonly body: Jolt.Body; readonly owner: JoltSoftBodyComponent; readonly vertexCount: number; }

/** Declaratively creates a mesh-backed Jolt soft body and keeps its vertices synchronized. */
@Component({
  selector: 'joltSoftBody',
  imports: [],
  template: '',
  providers: [provideObject3DComponent(JoltSoftBodyComponent)],
})
export class JoltSoftBodyComponent extends GroupComponent {
  readonly physics = inject(JoltPhysicsComponent);
  readonly service = inject(JoltPhysicsService);
  readonly vertices = input<ReadonlyArray<readonly [number, number, number]>>([]);
  readonly faces = input<ReadonlyArray<readonly [number, number, number]>>([]);
  readonly solverIterations = input(5);
  readonly linearDamping = input(0.1);
  readonly gravityFactor = input(1);
  /** Internal pressure multiplier for closed membranes such as balloons. */
  readonly pressure = input(0);
  readonly velocity = input<readonly [number, number, number]>([0, 0, 0]);
  readonly edgeCompliance = input(0.0001);
  readonly shearCompliance = input(0.0001);
  readonly bendCompliance = input(0.001);
  readonly color = input(0x4fd6a8);
  readonly created = output<IJoltSoftBodyCreatedEvent>();

  #body?: Jolt.Body;
  #mesh?: Mesh;
  #settings?: Jolt.SoftBodySharedSettings;

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
    for (const [x, y, z] of vertices) {
      vertex.mPosition.x = x;
      vertex.mPosition.y = y;
      vertex.mPosition.z = z;
      vertex.mInvMass = 1;
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
    shared.CreateConstraints(attributes, 1, metadata.Jolt.SoftBodySharedSettings_EBendType_None);
    metadata.Jolt.destroy(attributes);
    shared.Optimize();

    const bodyPosition = new metadata.Jolt.RVec3(...this.position());
    const bodyRotation = new metadata.Jolt.Quat(0, 0, 0, 1);
    const settings = new metadata.Jolt.SoftBodyCreationSettings(shared, bodyPosition, bodyRotation, LAYER_MOVING);
    settings.mNumIterations = this.solverIterations();
    settings.mLinearDamping = this.linearDamping();
    settings.mGravityFactor = this.gravityFactor();
    const bodyId = metadata.bodyInterface.CreateAndAddSoftBody(settings, metadata.Jolt.EActivation_Activate);
    this.#body = metadata.physicsSystem.GetBodyLockInterface().TryGetBody(bodyId);
    if (!this.#body) return;
    this.#settings = shared;
    metadata.Jolt.destroy(settings); metadata.Jolt.destroy(bodyPosition); metadata.Jolt.destroy(bodyRotation);

    const geometry = new BufferGeometry();
    const positionData = new Float32Array(vertices.length * 3);
    geometry.setAttribute('position', new BufferAttribute(positionData, 3));
    geometry.setIndex(faces.flatMap(([a, b, c]) => [a, b, c]));
    const mesh = new Mesh(geometry, new MeshStandardMaterial({ color: this.color(), side: DoubleSide, roughness: 0.55 }));
    this.#mesh = mesh;
    this.object3D().add(mesh);
    this.#setParticleVelocity(metadata.Jolt, this.velocity());
    const motion = metadata.Jolt.castObject(this.#body.GetMotionProperties(), metadata.Jolt.SoftBodyMotionProperties);
    motion.SetPressure(this.pressure());
    this.#syncVertices(metadata.Jolt);
    this.physics.physicsUpdated$.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(() => this.#syncVertices(metadata.Jolt));
    this.created.emit({ body: this.#body, owner: this, vertexCount: vertices.length });
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
    if (!this.#body || !this.#mesh) return;
    this.object3D().position.copy(wrapVec3(this.#body.GetPosition()));
    const motion = jolt.castObject(this.#body.GetMotionProperties(), jolt.SoftBodyMotionProperties);
    const vertices = motion.GetVertices();
    const offset = jolt.SoftBodyVertexTraits.prototype.mPositionOffset;
    const attribute = this.#mesh.geometry.getAttribute('position') as BufferAttribute;
    for (let i = 0; i < vertices.size(); i++) {
      const position = new Float32Array(jolt.HEAP32.buffer, jolt.getPointer(vertices.at(i)) + offset, 3);
      attribute.setXYZ(i, position[0], position[1], position[2]);
    }
    attribute.needsUpdate = true;
    this.#mesh.geometry.computeVertexNormals();
  }

  override ngOnDestroy(): void {
    this.dispose();
    super.ngOnDestroy();
  }

  /** Removes the live Jolt body before a topology replacement is created. */
  dispose(): void {
    const body = this.#body;
    const metadata = this.service.metaData$.value;
    if (body && metadata) {
      metadata.bodyInterface.RemoveBody(body.GetID());
      metadata.bodyInterface.DestroyBody(body.GetID());
    }
    if (this.#settings && metadata) metadata.Jolt.destroy(this.#settings);
    this.#body = undefined;
  }
}
