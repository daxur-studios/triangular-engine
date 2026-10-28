/**
 * Zero-allocation deformable Quadratic Bezier tube mesh for "rubber-hose" noodle limbs.
 *
 * Pre-allocates indexed vertex/normal buffers once and updates them in-place each frame
 * using a twist-free parallel transport (Bishop) frame along the curve $[P_0, P_1, P_2]$.
 */

import {
  BufferAttribute,
  BufferGeometry,
  Float32BufferAttribute,
  Mesh,
  MeshStandardMaterial,
  Quaternion,
  Vector3,
} from 'three';
import {
  evaluateQuadraticBezierPoint,
  evaluateQuadraticBezierTangent,
  type CharacterVector3,
  type RubberHoseLimbSolution,
} from 'triangular-engine/characters';

export interface RubberHoseLimbOptions {
  readonly name?: string;
  readonly radius?: number;
  readonly tubularSegments?: number;
  readonly radialSegments?: number;
  readonly material: MeshStandardMaterial;
}

export class RubberHoseLimbMesh {
  readonly mesh: Mesh<BufferGeometry, MeshStandardMaterial>;
  readonly geometry: BufferGeometry;
  private readonly posAttr: BufferAttribute;
  private readonly normAttr: BufferAttribute;
  private readonly radius: number;
  private readonly tubularSegments: number;
  private readonly radialSegments: number;
  private readonly cosTable: Float32Array;
  private readonly sinTable: Float32Array;

  private readonly tmpTangent = new Vector3();
  private readonly tmpPrevTangent = new Vector3();
  private readonly tmpNormal = new Vector3();
  private readonly tmpBinormal = new Vector3();
  private readonly tmpQuat = new Quaternion();
  private readonly tmpDown = new Vector3(0, -1, 0);

  constructor(options: RubberHoseLimbOptions) {
    this.radius = options.radius ?? 0.042;
    this.tubularSegments = options.tubularSegments ?? 18;
    this.radialSegments = options.radialSegments ?? 12;

    const ringVerts = this.radialSegments + 1;
    const totalRings = this.tubularSegments + 1;
    const vertexCount = totalRings * ringVerts;

    this.cosTable = new Float32Array(ringVerts);
    this.sinTable = new Float32Array(ringVerts);
    for (let j = 0; j <= this.radialSegments; j++) {
      const theta = (j / this.radialSegments) * Math.PI * 2;
      this.cosTable[j] = Math.cos(theta);
      this.sinTable[j] = Math.sin(theta);
    }

    const positions = new Float32Array(vertexCount * 3);
    const normals = new Float32Array(vertexCount * 3);
    const indices: number[] = [];

    for (let i = 0; i < this.tubularSegments; i++) {
      for (let j = 0; j < this.radialSegments; j++) {
        const a = i * ringVerts + j;
        const b = (i + 1) * ringVerts + j;
        const c = (i + 1) * ringVerts + (j + 1);
        const d = i * ringVerts + (j + 1);
        indices.push(a, b, d);
        indices.push(b, c, d);
      }
    }

    this.geometry = new BufferGeometry();
    this.posAttr = new Float32BufferAttribute(positions, 3);
    this.normAttr = new Float32BufferAttribute(normals, 3);
    this.geometry.setAttribute('position', this.posAttr);
    this.geometry.setAttribute('normal', this.normAttr);
    this.geometry.setIndex(indices);

    this.mesh = new Mesh(this.geometry, options.material);
    this.mesh.name = options.name ?? 'rubber-hose-limb';
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = true;
    this.mesh.frustumCulled = false;

    // Initialize with a vertical segment
    this.updateCurve(
      { x: 0, y: 0.6, z: 0 },
      { x: 0, y: 0.35, z: 0.04 },
      { x: 0, y: 0.1, z: 0 },
    );
  }

  /**
   * Updates the pre-allocated tube geometry in-place along the quadratic Bezier curve $[P_0, P_1, P_2]$.
   */
  updateFromSolution(solution: RubberHoseLimbSolution): void {
    this.updateCurve(solution.p0, solution.p1, solution.p2);
  }

  updateCurve(p0: CharacterVector3, p1: CharacterVector3, p2: CharacterVector3): void {
    const posArray = this.posAttr.array as Float32Array;
    const normArray = this.normAttr.array as Float32Array;
    const ringVerts = this.radialSegments + 1;

    // Seed initial normal perpendicular to the t=0 tangent
    const t0 = evaluateQuadraticBezierTangent(p0, p1, p2, 0);
    this.tmpPrevTangent.set(t0.x, t0.y, t0.z).normalize();

    // Pick a stable reference vector not collinear with tmpPrevTangent
    if (Math.abs(this.tmpPrevTangent.z) < 0.85) {
      this.tmpNormal.set(0, 0, 1);
    } else {
      this.tmpNormal.set(1, 0, 0);
    }
    this.tmpBinormal.crossVectors(this.tmpPrevTangent, this.tmpNormal).normalize();
    this.tmpNormal.crossVectors(this.tmpBinormal, this.tmpPrevTangent).normalize();

    for (let i = 0; i <= this.tubularSegments; i++) {
      const t = i / this.tubularSegments;
      const pt = evaluateQuadraticBezierPoint(p0, p1, p2, t);
      const tan = evaluateQuadraticBezierTangent(p0, p1, p2, t);
      this.tmpTangent.set(tan.x, tan.y, tan.z).normalize();

      if (i > 0) {
        // Parallel-transport the normal frame from previous tangent to current tangent
        this.tmpQuat.setFromUnitVectors(this.tmpPrevTangent, this.tmpTangent);
        this.tmpNormal.applyQuaternion(this.tmpQuat).normalize();
        this.tmpBinormal.crossVectors(this.tmpTangent, this.tmpNormal).normalize();
      }
      this.tmpPrevTangent.copy(this.tmpTangent);

      // Subtle wrist/ankle taper near the ends for organic rubber-hose silhouette
      const rScale = 1.0 - 0.06 * Math.sin(t * Math.PI);
      const r = this.radius * rScale;

      const baseVert = i * ringVerts;
      for (let j = 0; j <= this.radialSegments; j++) {
        const c = this.cosTable[j];
        const s = this.sinTable[j];

        const nx = c * this.tmpNormal.x + s * this.tmpBinormal.x;
        const ny = c * this.tmpNormal.y + s * this.tmpBinormal.y;
        const nz = c * this.tmpNormal.z + s * this.tmpBinormal.z;

        const idx = (baseVert + j) * 3;
        posArray[idx] = pt.x + r * nx;
        posArray[idx + 1] = pt.y + r * ny;
        posArray[idx + 2] = pt.z + r * nz;

        normArray[idx] = nx;
        normArray[idx + 1] = ny;
        normArray[idx + 2] = nz;
      }
    }

    this.posAttr.needsUpdate = true;
    this.normAttr.needsUpdate = true;
  }

  /**
   * Computes a quaternion aligning local `-Y` (downward glove/boot axis) with the end tangent at $t = 1$.
   */
  computeEndOrientation(endTangent: CharacterVector3, outQuat = new Quaternion()): Quaternion {
    this.tmpTangent.set(endTangent.x, endTangent.y, endTangent.z).normalize();
    return outQuat.setFromUnitVectors(this.tmpDown, this.tmpTangent);
  }

  dispose(): void {
    this.geometry.dispose();
  }
}
