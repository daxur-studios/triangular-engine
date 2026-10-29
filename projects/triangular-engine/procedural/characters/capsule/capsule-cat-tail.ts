/**
 * Zero-allocation tapered S-curved cat tail tube.
 *
 * The tail is a cubic Bezier spline with a plump base and a pinched tip, updated
 * in place each frame with a twist-free parallel-transport frame. A tiny sphere
 * caps the tip so the silhouette stays rounded from every angle.
 */

import {
  BufferAttribute,
  BufferGeometry,
  Color,
  Float32BufferAttribute,
  Group,
  Mesh,
  MeshStandardMaterial,
  Quaternion,
  SphereGeometry,
  Vector3,
} from 'three';
import type { CapsuleCatTailPose } from 'triangular-engine/characters';

export interface CapsuleCatTailOptions {
  readonly name?: string;
  readonly tubularSegments?: number;
  readonly radialSegments?: number;
  readonly color: string;
}

export interface CapsuleCatTailAssembly {
  readonly root: Group;
  readonly geometry: BufferGeometry;
  readonly material: MeshStandardMaterial;
  readonly updateFromPose: (pose: CapsuleCatTailPose) => void;
  readonly setColor: (hex: string) => void;
  readonly dispose: () => void;
}

export class CapsuleCatTailMesh implements CapsuleCatTailAssembly {
  readonly root = new Group();
  readonly geometry: BufferGeometry;
  readonly material: MeshStandardMaterial;

  private readonly posAttr: BufferAttribute;
  private readonly normAttr: BufferAttribute;
  private readonly tubularSegments: number;
  private readonly radialSegments: number;
  private readonly cosTable: Float32Array;
  private readonly sinTable: Float32Array;
  private readonly tipMesh: Mesh;

  private readonly tmpTangent = new Vector3();
  private readonly tmpPrevTangent = new Vector3();
  private readonly tmpNormal = new Vector3();
  private readonly tmpBinormal = new Vector3();
  private readonly tmpQuat = new Quaternion();

  constructor(options: CapsuleCatTailOptions) {
    this.tubularSegments = options.tubularSegments ?? 22;
    this.radialSegments = options.radialSegments ?? 12;
    this.root.name = options.name ?? 'capsule-cat-tail';
    this.material = new MeshStandardMaterial({
      color: new Color(options.color),
      roughness: 0.7,
      metalness: 0.02,
    });

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
        // Counter-clockwise from outside the tube: winding must agree with the
        // radial vertex normals written below or the tail renders inside out.
        indices.push(a, d, b, b, d, c);
      }
    }

    this.geometry = new BufferGeometry();
    this.posAttr = new Float32BufferAttribute(positions, 3);
    this.normAttr = new Float32BufferAttribute(normals, 3);
    this.geometry.setAttribute('position', this.posAttr);
    this.geometry.setAttribute('normal', this.normAttr);
    this.geometry.setIndex(indices);

    const tube = new Mesh(this.geometry, this.material);
    tube.name = 'capsule-cat-tail-tube';
    tube.castShadow = true;
    tube.receiveShadow = true;
    tube.frustumCulled = false;
    this.root.add(tube);

    this.tipMesh = new Mesh(new SphereGeometry(1, 12, 10), this.material);
    this.tipMesh.name = 'capsule-cat-tail-tip';
    this.tipMesh.castShadow = true;
    this.root.add(this.tipMesh);

    this.updateFromPose({
      base: { x: 0, y: 0.1, z: -0.4 },
      control1: { x: 0, y: 0.25, z: -0.55 },
      control2: { x: 0, y: 0.5, z: -0.62 },
      tip: { x: 0, y: 0.62, z: -0.4 },
      radius: 0.04,
    });
  }

  updateFromPose(pose: CapsuleCatTailPose): void {
    const posArray = this.posAttr.array as Float32Array;
    const normArray = this.normAttr.array as Float32Array;
    const ringVerts = this.radialSegments + 1;
    const p0x = pose.base.x;
    const p0y = pose.base.y;
    const p0z = pose.base.z;
    const p1x = pose.control1.x;
    const p1y = pose.control1.y;
    const p1z = pose.control1.z;
    const p2x = pose.control2.x;
    const p2y = pose.control2.y;
    const p2z = pose.control2.z;
    const p3x = pose.tip.x;
    const p3y = pose.tip.y;
    const p3z = pose.tip.z;

    // Seed a stable perpendicular normal from the t=0 tangent.
    const t0x = p1x - p0x;
    const t0y = p1y - p0y;
    const t0z = p1z - p0z;
    this.tmpPrevTangent.set(t0x, t0y, t0z).normalize();
    if (Math.abs(this.tmpPrevTangent.z) < 0.85) {
      this.tmpNormal.set(0, 0, 1);
    } else {
      this.tmpNormal.set(1, 0, 0);
    }
    this.tmpBinormal.crossVectors(this.tmpPrevTangent, this.tmpNormal).normalize();
    this.tmpNormal.crossVectors(this.tmpBinormal, this.tmpPrevTangent).normalize();

    for (let i = 0; i <= this.tubularSegments; i++) {
      const t = i / this.tubularSegments;
      const u = 1 - t;
      const b0 = u * u * u;
      const b1 = 3 * u * u * t;
      const b2 = 3 * u * t * t;
      const b3 = t * t * t;

      const px = b0 * p0x + b1 * p1x + b2 * p2x + b3 * p3x;
      const py = b0 * p0y + b1 * p1y + b2 * p2y + b3 * p3y;
      const pz = b0 * p0z + b1 * p1z + b2 * p2z + b3 * p3z;

      const tx =
        3 * u * u * (p1x - p0x) + 6 * u * t * (p2x - p1x) + 3 * t * t * (p3x - p2x);
      const ty =
        3 * u * u * (p1y - p0y) + 6 * u * t * (p2y - p1y) + 3 * t * t * (p3y - p2y);
      const tz =
        3 * u * u * (p1z - p0z) + 6 * u * t * (p2z - p1z) + 3 * t * t * (p3z - p2z);
      this.tmpTangent.set(tx, ty, tz).normalize();

      if (i > 0) {
        this.tmpQuat.setFromUnitVectors(this.tmpPrevTangent, this.tmpTangent);
        this.tmpNormal.applyQuaternion(this.tmpQuat).normalize();
        this.tmpBinormal.crossVectors(this.tmpTangent, this.tmpNormal).normalize();
      }
      this.tmpPrevTangent.copy(this.tmpTangent);

      // Plump base, gentle taper, pinched tip.
      const taper = Math.pow(Math.max(0, 1 - t), 0.72);
      const radius = Math.max(0.004, pose.radius * (0.25 + 0.75 * taper));

      const baseVert = i * ringVerts;
      for (let j = 0; j <= this.radialSegments; j++) {
        const c = this.cosTable[j];
        const s = this.sinTable[j];
        const nx = c * this.tmpNormal.x + s * this.tmpBinormal.x;
        const ny = c * this.tmpNormal.y + s * this.tmpBinormal.y;
        const nz = c * this.tmpNormal.z + s * this.tmpBinormal.z;
        const idx = (baseVert + j) * 3;
        posArray[idx] = px + radius * nx;
        posArray[idx + 1] = py + radius * ny;
        posArray[idx + 2] = pz + radius * nz;
        normArray[idx] = nx;
        normArray[idx + 1] = ny;
        normArray[idx + 2] = nz;
      }
    }

    this.posAttr.needsUpdate = true;
    this.normAttr.needsUpdate = true;

    const tipRadius = Math.max(0.006, pose.radius * 0.28);
    this.tipMesh.position.set(p3x, p3y, p3z);
    this.tipMesh.scale.setScalar(tipRadius);
  }

  setColor(hex: string): void {
    this.material.color.set(hex);
  }

  dispose(): void {
    this.geometry.dispose();
    this.tipMesh.geometry.dispose();
    this.material.dispose();
  }
}
