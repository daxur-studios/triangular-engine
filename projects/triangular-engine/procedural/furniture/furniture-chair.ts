import {
  BoxGeometry,
  Color,
  CylinderGeometry,
  Group,
  Matrix4,
  Mesh,
  MeshStandardMaterial,
  Vector3,
} from 'three';
import {
  characterVector3,
  validateSitAffordance,
  type CharacterSitAffordance,
} from 'triangular-engine/characters';
import type {
  IProceduralChairOptions,
  IProceduralChairResult,
} from './furniture-types';

const DEFAULT_SEAT_WIDTH = 0.46;
const DEFAULT_SEAT_DEPTH = 0.44;
const DEFAULT_SEAT_HEIGHT = 0.45;
const DEFAULT_SEAT_THICKNESS = 0.045;
const DEFAULT_BACKREST_HEIGHT = 0.45;
const DEFAULT_LEG_RADIUS = 0.02;
const DEFAULT_FRAME_COLOR = '#78350f'; // Warm rich walnut/amber wood
const DEFAULT_CUSHION_COLOR = '#334155'; // Slate upholstery

export function buildProceduralChair(options: IProceduralChairOptions = {}): IProceduralChairResult {
  const width = options.seatWidthM ?? DEFAULT_SEAT_WIDTH;
  const depth = options.seatDepthM ?? DEFAULT_SEAT_DEPTH;
  const seatHeight = options.seatHeightM ?? DEFAULT_SEAT_HEIGHT;
  const seatThickness = DEFAULT_SEAT_THICKNESS;
  const backHeight = options.style === 'stool' ? 0 : (options.backrestHeightM ?? DEFAULT_BACKREST_HEIGHT);
  const style = options.style ?? 'dining';
  const castShadow = options.castShadow ?? true;
  const receiveShadow = options.receiveShadow ?? true;

  const frameColor = options.frameColorHex ?? DEFAULT_FRAME_COLOR;
  const cushionColor = options.cushionColorHex ?? DEFAULT_CUSHION_COLOR;

  const frameMaterial = new MeshStandardMaterial({
    color: new Color(frameColor),
    roughness: 0.6,
    metalness: 0.1,
  });

  const cushionMaterial = new MeshStandardMaterial({
    color: new Color(cushionColor),
    roughness: 0.85,
    metalness: 0.05,
  });

  const geometries: { dispose(): void }[] = [];
  const root = new Group();
  root.name = `procedural-chair-${style}`;

  // 1. Seat Cushion / Board
  const seatGeom = new BoxGeometry(width, seatThickness, depth);
  geometries.push(seatGeom);
  const seatMesh = new Mesh(seatGeom, cushionMaterial);
  seatMesh.position.set(0, seatHeight - seatThickness / 2, 0);
  seatMesh.castShadow = castShadow;
  seatMesh.receiveShadow = receiveShadow;
  root.add(seatMesh);

  // 2. Legs (4 cylindrical tapered legs)
  const legHeight = seatHeight - seatThickness;
  const legGeom = new CylinderGeometry(DEFAULT_LEG_RADIUS * 0.9, DEFAULT_LEG_RADIUS * 0.65, legHeight, 8);
  geometries.push(legGeom);

  const halfW = width / 2;
  const halfD = depth / 2;
  const legInsetX = width * 0.12;
  const legInsetZ = depth * 0.12;

  const legPositions: [number, number, number][] = [
    [-halfW + legInsetX, legHeight / 2, halfD - legInsetZ], // Front Left
    [halfW - legInsetX, legHeight / 2, halfD - legInsetZ],  // Front Right
    [-halfW + legInsetX, legHeight / 2, -halfD + legInsetZ], // Back Left
    [halfW - legInsetX, legHeight / 2, -halfD + legInsetZ],  // Back Right
  ];

  for (const [lx, ly, lz] of legPositions) {
    const legMesh = new Mesh(legGeom, frameMaterial);
    legMesh.position.set(lx, ly, lz);
    legMesh.castShadow = castShadow;
    legMesh.receiveShadow = receiveShadow;
    root.add(legMesh);
  }

  // 3. Backrest (for dining and armchair)
  if (backHeight > 0.1) {
    const postHeight = backHeight + seatThickness;
    const postGeom = new CylinderGeometry(DEFAULT_LEG_RADIUS * 0.8, DEFAULT_LEG_RADIUS * 0.8, postHeight, 8);
    geometries.push(postGeom);

    const backZ = -halfD + legInsetZ * 0.8;
    const postY = seatHeight - seatThickness + postHeight / 2;

    const leftPost = new Mesh(postGeom, frameMaterial);
    leftPost.position.set(-halfW + legInsetX, postY, backZ);
    leftPost.castShadow = castShadow;
    root.add(leftPost);

    const rightPost = new Mesh(postGeom, frameMaterial);
    rightPost.position.set(halfW - legInsetX, postY, backZ);
    rightPost.castShadow = castShadow;
    root.add(rightPost);

    // Top rail
    const railWidth = width - legInsetX * 1.5;
    const railGeom = new BoxGeometry(railWidth, 0.06, 0.025);
    geometries.push(railGeom);
    const railMesh = new Mesh(railGeom, frameMaterial);
    railMesh.position.set(0, seatHeight + backHeight - 0.03, backZ);
    railMesh.castShadow = castShadow;
    root.add(railMesh);

    // Mid slat / cushion panel
    const panelGeom = new BoxGeometry(railWidth * 0.8, backHeight * 0.55, 0.018);
    geometries.push(panelGeom);
    const panelMesh = new Mesh(panelGeom, style === 'armchair' ? cushionMaterial : frameMaterial);
    panelMesh.position.set(0, seatHeight + backHeight * 0.45, backZ);
    panelMesh.castShadow = castShadow;
    root.add(panelMesh);
  }

  // 4. Armrests (if armchair)
  if (style === 'armchair') {
    const armHeight = 0.22;
    const armGeom = new BoxGeometry(0.04, 0.025, depth * 0.75);
    const armPostGeom = new CylinderGeometry(DEFAULT_LEG_RADIUS * 0.75, DEFAULT_LEG_RADIUS * 0.75, armHeight, 8);
    geometries.push(armGeom, armPostGeom);

    for (const sign of [-1, 1]) {
      const armX = sign * (halfW - 0.02);
      const postMesh = new Mesh(armPostGeom, frameMaterial);
      postMesh.position.set(armX, seatHeight + armHeight / 2, halfD - 0.08);
      postMesh.castShadow = castShadow;
      root.add(postMesh);

      const restMesh = new Mesh(armGeom, cushionMaterial);
      restMesh.position.set(armX, seatHeight + armHeight, 0);
      restMesh.castShadow = castShadow;
      root.add(restMesh);
    }
  }

  const baseApproachOffsetZ = depth * 0.5 + 0.35;

  const sitAffordance: CharacterSitAffordance = {
    id: `chair-sit-${root.id}`,
    seatPosition: characterVector3(0, seatHeight, 0),
    seatHeight,
    approachPosition: characterVector3(0, 0, baseApproachOffsetZ),
    facingDirection: characterVector3(0, 0, 1),
    clearanceRadius: Math.max(width, depth) * 0.75,
    occupied: false,
  };
  validateSitAffordance(sitAffordance);

  const getSitAffordance = (worldMatrix?: Matrix4): CharacterSitAffordance => {
    const mat = worldMatrix ?? root.matrixWorld;
    if (!worldMatrix) {
      root.updateMatrixWorld(true);
    }

    const worldSeat = new Vector3(0, seatHeight, 0).applyMatrix4(mat);
    const worldApproach = new Vector3(0, 0, baseApproachOffsetZ).applyMatrix4(mat);
    const worldFacing = new Vector3(0, 0, 1).transformDirection(mat).normalize();

    const affordance: CharacterSitAffordance = {
      id: sitAffordance.id,
      seatPosition: characterVector3(worldSeat.x, worldSeat.y, worldSeat.z),
      seatHeight: worldSeat.y,
      approachPosition: characterVector3(worldApproach.x, worldApproach.y, worldApproach.z),
      facingDirection: characterVector3(worldFacing.x, worldFacing.y, worldFacing.z),
      clearanceRadius: sitAffordance.clearanceRadius,
      occupied: sitAffordance.occupied,
    };
    validateSitAffordance(affordance);
    return affordance;
  };

  const dispose = (): void => {
    geometries.forEach((g) => g.dispose());
    frameMaterial.dispose();
    cushionMaterial.dispose();
  };

  return {
    group: root,
    sitAffordance,
    getSitAffordance,
    dispose,
  };
}
