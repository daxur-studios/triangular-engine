import {
  Component,
  DestroyRef,
  effect,
  inject,
  input,
  OnDestroy,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

import {
  BufferAttribute,
  BufferGeometry,
  EdgesGeometry,
  InterleavedBuffer,
  InterleavedBufferAttribute,
  LineBasicMaterial,
  LineSegments,
  Matrix4,
  Mesh,
  MeshPhongMaterial,
  DoubleSide,
  FrontSide,
  BackSide,
  Vector3,
} from 'three';
import { CSS2DObject } from 'three/examples/jsm/renderers/CSS2DRenderer.js';
import { EngineService } from '../../../services/engine.service';
import { wrapVec3, wrapQuat, createMeshForShape } from '../example';
import { JoltPhysicsComponent } from '../jolt-physics/jolt-physics.component';
import { Jolt, JoltPhysicsService } from '../jolt-physics/jolt-physics.service';

@Component({
  selector: 'jolt-debug-renderer',
  imports: [],
  templateUrl: './jolt-debug-renderer.component.html',
  styleUrl: './jolt-debug-renderer.component.scss',
})
export class JoltDebugRendererComponent implements OnDestroy {
  readonly engineService = inject(EngineService);
  readonly parentPhysics = inject(JoltPhysicsComponent);
  readonly destroyRef = inject(DestroyRef);
  readonly physicsService = inject(JoltPhysicsService);

  readonly drawBodies = input<boolean>(true);
  readonly drawConstraints = input<boolean>(true);
  readonly linesOnly = input<boolean>(true);
  readonly enabled = input<boolean>(true);
  readonly constraintColor = input<number>(0xff0000);

  private initialized = false;

  // Caches
  private materialCache = new Map<string, MeshPhongMaterial>();
  private lineCache: Record<number, Vector3[]> = {};
  private lineMesh: Record<number, LineSegments> = {};
  private triangleCache: Record<number, Vector3[]> = {}; // not currently used by Jolt callbacks here
  private triangleMesh: Record<number, Mesh> = {};
  private geometryCache: BufferGeometry[] = [];
  private edgesCache = new WeakMap<BufferGeometry, BufferGeometry>();
  private geometryList: Array<{
    geometry: BufferGeometry;
    color: number;
    matrix: Matrix4;
    cullMode?: number;
    drawMode?: number;
  }> = [];
  private meshList: Mesh[] = [];
  private batchLineList: LineSegments[] = [];
  private textList: Array<{
    color: number;
    position: Vector3;
    height: number;
    text: string;
  }> = [];
  private textCache: CSS2DObject[] = [];

  private renderer!: any; // Jolt.DebugRendererJS
  private bodyDrawSettings!: any;
  private isDebugWasmVersion = false;

  // Fallback (non-debug WASM) aggregated line renderer
  private fallbackActiveLine?: LineSegments;
  private fallbackSleepingLine?: LineSegments;
  private fallbackConstraintsLine?: LineSegments;
  private fallbackEdgesByShapePtr = new Map<number, EdgesGeometry>();

  constructor() {
    effect(() => {
      const drawBodies = this.drawBodies();
      const drawConstraints = this.drawConstraints();
      void drawBodies;
      void drawConstraints;
    });
    this.initOnceJoltReady();
  }

  ngOnDestroy(): void {
    this.renderer?.Destroy();
    // remove all from scene
    this.batchLineList.forEach((line) => {
      this.engineService.scene.remove(line);
    });
    this.meshList.forEach((mesh) => {
      this.engineService.scene.remove(mesh);
    });
    this.textCache.forEach((text) => {
      this.engineService.scene.remove(text);
    });

    if (this.fallbackActiveLine)
      this.engineService.scene.remove(this.fallbackActiveLine);
    if (this.fallbackSleepingLine)
      this.engineService.scene.remove(this.fallbackSleepingLine);
    if (this.fallbackConstraintsLine)
      this.engineService.scene.remove(this.fallbackConstraintsLine);
  }

  private async initOnceJoltReady() {
    const meta = await this.parentPhysics.metaDataPromise;
    if (!meta) return;

    const isDebugWasmVersion = (Jolt as any).DebugRendererJS !== undefined;
    this.isDebugWasmVersion = isDebugWasmVersion;

    if (this.isDebugWasmVersion) {
      this.renderer = new (Jolt as any).DebugRendererJS();
      this.renderer.DrawLine = this.drawLine.bind(this);
      this.renderer.DrawTriangle = this.drawTriangle.bind(this);
      this.renderer.DrawText3D = this.drawText3D.bind(this);
      this.renderer.DrawGeometryWithID = this.drawGeometryWithID.bind(this);
      this.renderer.CreateTriangleBatchID =
        this.createTriangleBatchID.bind(this);
      this.renderer.CreateTriangleBatchIDWithIndex =
        this.createTriangleBatchIDWithIndex.bind(this);

      this.bodyDrawSettings = new (Jolt as any).BodyManagerDrawSettings();
    }

    this.parentPhysics.physicsUpdated$
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => this.onTick());
  }

  private Initialize() {
    if (!this.initialized) {
      this.renderer.Initialize();
      this.initialized = true;
    }
  }

  private onTick() {
    const physicsSystem = (this.parentPhysics as any).metaDat$.value
      ?.physicsSystem;
    if (!physicsSystem) return;

    if (!this.enabled()) {
      this.hideAllDebugMeshes();
      return;
    }

    if (this.isDebugWasmVersion) {
      this.Initialize();

      if (this.drawBodies())
        this.renderer.DrawBodies(physicsSystem, this.bodyDrawSettings);
      if (this.drawConstraints()) {
        this.renderer.DrawConstraints(physicsSystem);
        this.renderer.DrawConstraintLimits(physicsSystem);
      }

      this.Render();
    } else {
      this.RenderFallback();
    }
  }

  // Callbacks from Jolt.DebugRendererJS
  private unwrapV3(ptr: number): Vector3 {
    return wrapVec3(Jolt.wrapPointer(ptr, (Jolt as any).RVec3));
  }

  private drawLine(inFrom: number, inTo: number, inColor: number) {
    const colorU32 =
      (Jolt.wrapPointer(inColor, (Jolt as any).Color) as any).mU32 >>> 0;
    const arr = (this.lineCache[colorU32] = this.lineCache[colorU32] || []);
    const v0 = this.unwrapV3(inFrom);
    const v1 = this.unwrapV3(inTo);
    arr.push(v0, v1);
  }

  private drawTriangle(
    inV1: number,
    inV2: number,
    inV3: number,
    inColor: number,
    _inCastShadow: number,
  ) {
    const colorU32 =
      (Jolt.wrapPointer(inColor, (Jolt as any).Color) as any).mU32 >>> 0;
    const arr = (this.lineCache[colorU32] = this.lineCache[colorU32] || []);
    const v0 = this.unwrapV3(inV1);
    const v1 = this.unwrapV3(inV2);
    const v2 = this.unwrapV3(inV3);
    arr.push(v0, v1);
    arr.push(v1, v2);
    arr.push(v2, v0);
  }

  private drawText3D(
    inPosition: number,
    inStringPtr: number,
    inStringLen: number,
    inColor: number,
    inHeight: number,
  ) {
    const color =
      (Jolt.wrapPointer(inColor, (Jolt as any).Color) as any).mU32 >>> 0;
    const position = this.unwrapV3(inPosition);
    const textDecoder = new TextDecoder();
    const text = textDecoder.decode(
      (Jolt as any).HEAPU8.subarray(inStringPtr, inStringPtr + inStringLen),
    );
    this.textList.push({ color, position, height: inHeight, text });
  }

  private drawGeometryWithID(
    inModelMatrix: number,
    _inWorldSpaceBounds: number,
    _inLODScaleSq: number,
    inModelColor: number,
    inGeometryID: number,
    inCullMode?: number,
    inCastShadow?: number,
    inDrawMode?: number,
  ) {
    void _inWorldSpaceBounds;
    void _inLODScaleSq;
    void inCastShadow;
    const colorU32 =
      (Jolt.wrapPointer(inModelColor, (Jolt as any).Color) as any).mU32 >>> 0;
    const modelMatrix = Jolt.wrapPointer(inModelMatrix, (Jolt as any).RMat44);
    const v0 = wrapVec3(modelMatrix.GetAxisX());
    const v1 = wrapVec3(modelMatrix.GetAxisY());
    const v2 = wrapVec3(modelMatrix.GetAxisZ());
    const v3 = wrapVec3(modelMatrix.GetTranslation());
    const matrix = new Matrix4().makeBasis(v0, v1, v2).setPosition(v3);
    this.geometryList.push({
      matrix,
      geometry: this.geometryCache[inGeometryID],
      color: colorU32,
      drawMode: inDrawMode,
      cullMode: inCullMode,
    });
  }

  private createTriangleBatchID(inTriangles: number, inTriangleCount: number) {
    const batchID = this.geometryCache.length;
    const traits = (Jolt as any).DebugRendererVertexTraits.prototype;
    const triTraits = (Jolt as any).DebugRendererTriangleTraits.prototype;
    const { mPositionOffset, mNormalOffset, mUVOffset, mSize } = traits;

    const interleaveBufferF32 = new Float32Array(
      (inTriangleCount * 3 * mSize) / 4,
    );
    if (triTraits.mVOffset === 0 && triTraits.mSize === mSize * 3) {
      interleaveBufferF32.set(
        new Float32Array(
          (Jolt as any).HEAPF32.buffer,
          inTriangles,
          interleaveBufferF32.length,
        ),
      );
    } else {
      const vertexChunk = (mSize / 4) * 3;
      for (let i = 0; i < inTriangleCount; i++) {
        const triOffset =
          inTriangles + i * triTraits.mSize + triTraits.mVOffset;
        interleaveBufferF32.set(
          new Float32Array(
            (Jolt as any).HEAPF32.buffer,
            triOffset,
            i * vertexChunk,
          ),
        );
      }
    }

    const geometry = new BufferGeometry();
    const interleavedBuffer = new InterleavedBuffer(
      interleaveBufferF32,
      mSize / 4,
    );
    geometry.setAttribute(
      'position',
      new InterleavedBufferAttribute(interleavedBuffer, 3, mPositionOffset / 4),
    );
    geometry.setAttribute(
      'normal',
      new InterleavedBufferAttribute(interleavedBuffer, 3, mNormalOffset / 4),
    );
    geometry.setAttribute(
      'uv',
      new InterleavedBufferAttribute(interleavedBuffer, 2, mUVOffset / 4),
    );
    this.geometryCache.push(geometry);
    return batchID;
  }

  private createTriangleBatchIDWithIndex(
    inVertices: number,
    inVertexCount: number,
    inIndices: number,
    inIndexCount: number,
  ) {
    const batchID = this.geometryCache.length;
    const traits = (Jolt as any).DebugRendererVertexTraits.prototype;
    const { mPositionOffset, mNormalOffset, mUVOffset, mSize } = traits;
    const interleaveBufferF32 = new Float32Array((inVertexCount * mSize) / 4);
    interleaveBufferF32.set(
      new Float32Array(
        (Jolt as any).HEAPF32.buffer,
        inVertices,
        interleaveBufferF32.length,
      ),
    );
    const index = new Uint32Array(inIndexCount);
    index.set(
      (Jolt as any).HEAPU32.subarray(
        inIndices / 4,
        inIndices / 4 + inIndexCount,
      ),
    );
    const geometry = new BufferGeometry();
    const interleavedBuffer = new InterleavedBuffer(
      interleaveBufferF32,
      mSize / 4,
    );
    geometry.setAttribute(
      'position',
      new InterleavedBufferAttribute(interleavedBuffer, 3, mPositionOffset / 4),
    );
    geometry.setAttribute(
      'normal',
      new InterleavedBufferAttribute(interleavedBuffer, 3, mNormalOffset / 4),
    );
    geometry.setAttribute(
      'uv',
      new InterleavedBufferAttribute(interleavedBuffer, 2, mUVOffset / 4),
    );
    geometry.setIndex(new BufferAttribute(index, 1));
    this.geometryCache.push(geometry);
    return batchID;
  }

  private getMeshMaterial(color: number, cullMode?: number, drawMode?: number) {
    const key = `${color}|${cullMode}|${drawMode}`;
    let material = this.materialCache.get(key);
    if (!material) {
      material = new MeshPhongMaterial({ color });
      // Render debug geometry as wireframe lines by default and overlay on top
      material.wireframe = true;
      material.depthTest = false;
      material.depthWrite = false;
      if (cullMode !== undefined) {
        switch (cullMode) {
          case (Jolt as any).ECullMode_Off:
            material.side = DoubleSide;
            break;
          case (Jolt as any).ECullMode_CullBackFace:
            material.side = FrontSide;
            break;
          case (Jolt as any).ECullMode_CullFrontFace:
            material.side = BackSide;
            break;
        }
      }
      this.materialCache.set(key, material);
    }
    return material;
  }

  private Render() {
    const scene = this.engineService.scene;

    // Hide previous meshes
    [
      Object.values(this.lineMesh),
      Object.values(this.triangleMesh),
      this.meshList,
      this.batchLineList,
      this.textCache,
    ].forEach((meshes) => {
      meshes.forEach((mesh) => (mesh.visible = false));
    });

    // Lines
    Object.entries(this.lineCache).forEach(([colorU32, points]) => {
      const color = parseInt(colorU32, 10);
      if (this.lineMesh[color]) {
        const geometry = this.lineMesh[color].geometry as BufferGeometry;
        geometry.setFromPoints(points);
        this.lineMesh[color].visible = true;
      } else {
        const material = new LineBasicMaterial({
          color,
          depthTest: false,
          depthWrite: false,
        });
        const geometry = new BufferGeometry().setFromPoints(points);
        const mesh = (this.lineMesh[color] = new LineSegments(
          geometry,
          material,
        ));
        scene.add(mesh);
      }
    });

    // Geometry batches
    this.geometryList.forEach(
      ({ geometry, color, matrix, cullMode, drawMode }, i) => {
        if (this.linesOnly()) {
          let line = this.batchLineList[i];
          let edges = this.edgesCache.get(geometry);
          if (!edges) {
            edges = new EdgesGeometry(geometry);
            this.edgesCache.set(geometry, edges);
          }
          if (!line) {
            const material = new LineBasicMaterial({
              color,
              depthTest: false,
              depthWrite: false,
            });
            line = this.batchLineList[i] = new LineSegments(edges, material);
            scene.add(line);
          } else {
            line.geometry = edges;
            const mat = line.material as LineBasicMaterial;
            mat.color.set(color);
          }
          matrix.decompose(line.position, line.quaternion, line.scale);
          line.visible = true;
        } else {
          const material = this.getMeshMaterial(color, cullMode, drawMode);
          let mesh = this.meshList[i];
          if (!mesh) {
            mesh = this.meshList[i] = new Mesh(geometry, material);
            scene.add(mesh);
          } else {
            mesh.material = material;
            mesh.geometry = geometry;
          }
          matrix.decompose(mesh.position, mesh.quaternion, mesh.scale);
          mesh.visible = true;
        }
      },
    );

    // Text via CSS2D (simplified)
    if (!this.linesOnly())
      this.textList.forEach(({ position, text, color, height }, i) => {
        let label = this.textCache[i];
        if (!label) {
          const div = document.createElement('div');
          div.style.fontSize = '12px';
          div.style.color = `#${('000000' + color.toString(16)).slice(-6)}`;
          div.textContent = text;
          label = this.textCache[i] = new CSS2DObject(div);
          scene.add(label);
        } else {
          label.element.textContent = text;
          (label.element as HTMLElement).style.color =
            `#${('000000' + color.toString(16)).slice(-6)}`;
        }
        label.position.copy(position);
        label.visible = true;
      });

    // Clear accumulators
    this.geometryList = [];
    this.textList = [];
    this.lineCache = {};
    this.triangleCache = {};
  }

  private hideAllDebugMeshes() {
    [
      Object.values(this.lineMesh),
      Object.values(this.triangleMesh),
      this.meshList,
      this.batchLineList,
      this.textCache,
    ].forEach((meshes) => {
      meshes.forEach((mesh) => (mesh.visible = false));
    });
    if (this.fallbackActiveLine) this.fallbackActiveLine.visible = false;
    if (this.fallbackSleepingLine) this.fallbackSleepingLine.visible = false;
    if (this.fallbackConstraintsLine)
      this.fallbackConstraintsLine.visible = false;
  }

  private getFallbackEdgesGeometry(shape: any): EdgesGeometry {
    const ptr = (Jolt as any).getPointer
      ? (Jolt as any).getPointer(shape)
      : undefined;
    const key = ptr ?? shape;
    let edges = this.fallbackEdgesByShapePtr.get(key as number);
    if (!edges) {
      const triGeom = createMeshForShape(shape);
      edges = new EdgesGeometry(triGeom);
      this.fallbackEdgesByShapePtr.set(key as number, edges);
    }
    return edges;
  }

  private RenderFallback() {
    const scene = this.engineService.scene;

    // Hide all rich debug objects if previously created
    [
      Object.values(this.lineMesh),
      Object.values(this.triangleMesh),
      this.meshList,
      this.batchLineList,
      this.textCache,
    ].forEach((meshes) => {
      meshes.forEach((mesh) => (mesh.visible = false));
    });

    // Clear caches that might contain stale references to destroyed bodies
    this.geometryList = [];
    this.textList = [];
    this.lineCache = {};
    this.triangleCache = {};

    const activePositions: number[] = [];
    const sleepingPositions: number[] = [];
    const constraintPositions: number[] = [];
    const v = new Vector3();

    // Get current physics system to validate body references
    const physicsSystem = this.parentPhysics.metaDat$.value?.physicsSystem;
    if (!physicsSystem) return;

    // Build validated allBodies: skip destroyed ones with GetID check (cheap validation)
    const allBodies: Jolt.Body[] = [];
    for (const obj of this.parentPhysics.dynamicObjects) {
      const body = obj.userData['body'];
      if (!body) continue;
      try {
        body.GetID(); // If this succeeds, body is valid enough
        allBodies.push(body);
      } catch (error) {
        console.warn('Skipping destroyed body in dynamicObjects:', error);
        // Clean up stale ref
        delete obj.userData['body'];
      }
    }
    for (const body of this.physicsService.bodies$.value) {
      if (!body) continue;
      try {
        body.GetID();
        allBodies.push(body);
      } catch (error) {
        console.warn('Skipping destroyed body in service:', error);
      }
    }

    // Aggregate all shapes' edges into separate buffers based on active/sleep state
    for (const body of allBodies) {
      // Skip destroyed or invalid bodies
      if (!body) continue;

      try {
        // Test if body is still valid by checking if we can get its position
        const pos = wrapVec3(body.GetPosition());
        if (!pos || !isFinite(pos.x) || !isFinite(pos.y) || !isFinite(pos.z))
          continue;

        const shape = body.GetShape();
        if (!shape) continue;

        const edges = this.getFallbackEdgesGeometry(shape);
        const arr = (edges.getAttribute('position') as BufferAttribute)
          .array as ArrayLike<number>;

        const rot = wrapQuat(body.GetRotation());
        const m = new Matrix4()
          .makeRotationFromQuaternion(rot)
          .setPosition(pos);

        // Active if the body is currently awake; otherwise treat as sleeping
        const isActive = body.IsActive();
        const targetPositions = isActive ? activePositions : sleepingPositions;

        for (let i = 0; i < arr.length; i += 3) {
          v.set(
            arr[i] as number,
            arr[i + 1] as number,
            arr[i + 2] as number,
          ).applyMatrix4(m);
          targetPositions.push(v.x, v.y, v.z);
        }
      } catch (error) {
        // Skip this body if it causes any errors (likely destroyed)
        console.warn('Skipping body in renderer loop:', error);
        continue;
      }
    }

    if (this.drawConstraints()) {
      for (const { a, b, constraint } of this.physicsService.constraints$
        .value) {
        // Skip constraints with destroyed bodies
        if (!a || !b || !constraint) continue;

        try {
          // Validate with GetID before position calls
          a.GetID();
          b.GetID();

          const pa = wrapVec3(a.GetPosition());
          const pb = wrapVec3(b.GetPosition());

          // Check if positions are valid (not NaN or infinite)
          if (
            !pa ||
            !pb ||
            !isFinite(pa.x) ||
            !isFinite(pa.y) ||
            !isFinite(pa.z) ||
            !isFinite(pb.x) ||
            !isFinite(pb.y) ||
            !isFinite(pb.z)
          ) {
            continue;
          }

          constraintPositions.push(pa.x, pa.y, pa.z, pb.x, pb.y, pb.z);
        } catch (error) {
          // Skip this constraint if it causes any errors (likely destroyed bodies)
          console.warn('Skipping constraint:', error);
          continue;
        }
      }
    }

    // Handle active bodies (bright burgundy)
    if (activePositions.length === 0) {
      if (this.fallbackActiveLine) this.fallbackActiveLine.visible = false;
    } else {
      if (!this.fallbackActiveLine) {
        const material = new LineBasicMaterial({
          color: 0xffff00, // Bright yellow
          depthTest: false,
          depthWrite: false,
        });
        const geometry = new BufferGeometry();
        geometry.setAttribute(
          'position',
          new BufferAttribute(new Float32Array(activePositions), 3),
        );
        this.fallbackActiveLine = new LineSegments(geometry, material);
        this.fallbackActiveLine.frustumCulled = false;
        scene.add(this.fallbackActiveLine);
      } else {
        const geometry = this.fallbackActiveLine.geometry as BufferGeometry;
        const attr = geometry.getAttribute('position') as
          | BufferAttribute
          | undefined;
        if (!attr || attr.array.length !== activePositions.length) {
          geometry.setAttribute(
            'position',
            new BufferAttribute(new Float32Array(activePositions), 3),
          );
        } else {
          (attr.array as Float32Array).set(activePositions);
          attr.needsUpdate = true;
        }
        this.fallbackActiveLine.visible = true;
      }
    }

    // Handle sleeping bodies (dark burgundy)
    if (sleepingPositions.length === 0) {
      if (this.fallbackSleepingLine) this.fallbackSleepingLine.visible = false;
    } else {
      if (!this.fallbackSleepingLine) {
        const material = new LineBasicMaterial({
          color: 0x4b0010, // Dark burgundy
          depthTest: false,
          depthWrite: false,
        });
        const geometry = new BufferGeometry();
        geometry.setAttribute(
          'position',
          new BufferAttribute(new Float32Array(sleepingPositions), 3),
        );
        this.fallbackSleepingLine = new LineSegments(geometry, material);
        this.fallbackSleepingLine.frustumCulled = false;
        scene.add(this.fallbackSleepingLine);
      } else {
        const geometry = this.fallbackSleepingLine.geometry as BufferGeometry;
        const attr = geometry.getAttribute('position') as
          | BufferAttribute
          | undefined;
        if (!attr || attr.array.length !== sleepingPositions.length) {
          geometry.setAttribute(
            'position',
            new BufferAttribute(new Float32Array(sleepingPositions), 3),
          );
        } else {
          (attr.array as Float32Array).set(sleepingPositions);
          attr.needsUpdate = true;
        }
        this.fallbackSleepingLine.visible = true;
      }
    }

    // Constraints line (second color)
    if (this.drawConstraints() && constraintPositions.length > 0) {
      if (!this.fallbackConstraintsLine) {
        const material = new LineBasicMaterial({
          color: this.constraintColor(),
          depthTest: false,
          depthWrite: false,
        });
        const geometry = new BufferGeometry();
        geometry.setAttribute(
          'position',
          new BufferAttribute(new Float32Array(constraintPositions), 3),
        );
        this.fallbackConstraintsLine = new LineSegments(geometry, material);
        this.fallbackConstraintsLine.frustumCulled = false;
        scene.add(this.fallbackConstraintsLine);
      } else {
        const geometry = this.fallbackConstraintsLine
          .geometry as BufferGeometry;
        const attr = geometry.getAttribute('position') as
          | BufferAttribute
          | undefined;
        if (!attr || attr.array.length !== constraintPositions.length) {
          geometry.setAttribute(
            'position',
            new BufferAttribute(new Float32Array(constraintPositions), 3),
          );
        } else {
          (attr.array as Float32Array).set(constraintPositions);
          attr.needsUpdate = true;
        }
        // Update color live in case input changes
        const mat = this.fallbackConstraintsLine.material as LineBasicMaterial;
        mat.color.set(this.constraintColor());
        this.fallbackConstraintsLine.visible = true;
      }
    } else if (this.fallbackConstraintsLine) {
      this.fallbackConstraintsLine.visible = false;
    }
  }
}
