import {
  BoxGeometry,
  Color,
  CylinderGeometry,
  Group,
  Matrix4,
  Mesh,
  MeshStandardMaterial,
  SphereGeometry,
  Vector3,
} from 'three';
import {
  characterVector3,
  validateDoorAffordance,
  validateReachAffordance,
  type CharacterDoorAffordance,
  type CharacterReachAffordance,
} from 'triangular-engine/characters';
import type {
  IProceduralDoorOptions,
  IProceduralDoorResult,
} from './furniture-types';

const DEFAULT_FRAME_WIDTH = 0.94;
const DEFAULT_FRAME_HEIGHT = 2.10;
const DEFAULT_FRAME_DEPTH = 0.09;
const DEFAULT_JAMB_THICKNESS = 0.045;
const DEFAULT_LEAF_THICKNESS = 0.04;
const DEFAULT_KNOB_HEIGHT = 0.98;
const DEFAULT_MAX_ANGLE = Math.PI / 2;

const DEFAULT_FRAME_COLOR = '#1e293b'; // Slate dark frame
const DEFAULT_DOOR_COLOR = '#92400e';  // Amber/oak stained wood
const DEFAULT_KNOB_COLOR = '#e2e8f0';  // Satin nickel metal

export function buildProceduralDoor(options: IProceduralDoorOptions = {}): IProceduralDoorResult {
  const frameWidth = options.frameWidthM ?? DEFAULT_FRAME_WIDTH;
  const frameHeight = options.frameHeightM ?? DEFAULT_FRAME_HEIGHT;
  const frameDepth = options.frameDepthM ?? DEFAULT_FRAME_DEPTH;
  const jambThickness = DEFAULT_JAMB_THICKNESS;
  const leafThickness = options.doorThicknessM ?? DEFAULT_LEAF_THICKNESS;
  const knobHeight = options.knobHeightM ?? DEFAULT_KNOB_HEIGHT;
  const knobStyle = options.knobStyle ?? 'round';
  const hingeSide = options.hingeSide ?? 'left';
  const castShadow = options.castShadow ?? true;
  const receiveShadow = options.receiveShadow ?? true;

  const frameColor = options.frameColorHex ?? DEFAULT_FRAME_COLOR;
  const doorColor = options.doorColorHex ?? DEFAULT_DOOR_COLOR;
  const knobColor = options.knobColorHex ?? DEFAULT_KNOB_COLOR;

  const frameMaterial = new MeshStandardMaterial({
    color: new Color(frameColor),
    roughness: 0.7,
    metalness: 0.15,
  });

  const doorMaterial = new MeshStandardMaterial({
    color: new Color(doorColor),
    roughness: 0.55,
    metalness: 0.05,
  });

  const knobMaterial = new MeshStandardMaterial({
    color: new Color(knobColor),
    roughness: 0.3,
    metalness: 0.85,
  });

  const geometries: { dispose(): void }[] = [];
  const root = new Group();
  root.name = `procedural-door-${hingeSide}`;

  // 1. Outer Frame (Left post, Right post, Top header)
  const postHeight = frameHeight;
  const postGeom = new BoxGeometry(jambThickness, postHeight, frameDepth);
  geometries.push(postGeom);

  const halfFrameW = frameWidth / 2;
  const leftPost = new Mesh(postGeom, frameMaterial);
  leftPost.position.set(-halfFrameW + jambThickness / 2, postHeight / 2, 0);
  leftPost.castShadow = castShadow;
  leftPost.receiveShadow = receiveShadow;
  root.add(leftPost);

  const rightPost = new Mesh(postGeom, frameMaterial);
  rightPost.position.set(halfFrameW - jambThickness / 2, postHeight / 2, 0);
  rightPost.castShadow = castShadow;
  rightPost.receiveShadow = receiveShadow;
  root.add(rightPost);

  const headerWidth = frameWidth - jambThickness * 2;
  const headerGeom = new BoxGeometry(headerWidth, jambThickness, frameDepth);
  geometries.push(headerGeom);
  const headerMesh = new Mesh(headerGeom, frameMaterial);
  headerMesh.position.set(0, frameHeight - jambThickness / 2, 0);
  headerMesh.castShadow = castShadow;
  headerMesh.receiveShadow = receiveShadow;
  root.add(headerMesh);

  // 2. Door Leaf (Panel) & Hinge Pivot Group
  const leafWidth = headerWidth - 0.01; // small 5mm tolerance clearance
  const leafHeight = frameHeight - jambThickness - 0.015;

  const hingeGroup = new Group();
  hingeGroup.name = `door-hinge-${hingeSide}`;

  // Place hinge pivot at the left or right inside edge of the jamb
  const hingePivotX = hingeSide === 'left'
    ? -halfFrameW + jambThickness
    : halfFrameW - jambThickness;
  hingeGroup.position.set(hingePivotX, 0, 0);
  root.add(hingeGroup);

  // The door leaf mesh inside the hinge group.
  // Pivot is at x=0 of hingeGroup, leaf extends towards the opening latch.
  const leafGeom = new BoxGeometry(leafWidth, leafHeight, leafThickness);
  geometries.push(leafGeom);
  const leafMesh = new Mesh(leafGeom, doorMaterial);
  const leafOffsetX = hingeSide === 'left' ? leafWidth / 2 : -leafWidth / 2;
  leafMesh.position.set(leafOffsetX, leafHeight / 2, 0);
  leafMesh.castShadow = castShadow;
  leafMesh.receiveShadow = receiveShadow;
  hingeGroup.add(leafMesh);

  // Decorative panel bevels/recesses
  const panelMargin = 0.08;
  const innerPanelW = leafWidth - panelMargin * 2;
  const upperPanelH = leafHeight * 0.42;
  const lowerPanelH = leafHeight * 0.35;
  const panelGeomUpper = new BoxGeometry(innerPanelW, upperPanelH, leafThickness * 1.1);
  const panelGeomLower = new BoxGeometry(innerPanelW, lowerPanelH, leafThickness * 1.1);
  geometries.push(panelGeomUpper, panelGeomLower);

  const upperPanelMesh = new Mesh(panelGeomUpper, doorMaterial);
  upperPanelMesh.position.set(leafOffsetX, leafHeight * 0.72, 0);
  upperPanelMesh.castShadow = castShadow;
  hingeGroup.add(upperPanelMesh);

  const lowerPanelMesh = new Mesh(panelGeomLower, doorMaterial);
  lowerPanelMesh.position.set(leafOffsetX, leafHeight * 0.28, 0);
  lowerPanelMesh.castShadow = castShadow;
  hingeGroup.add(lowerPanelMesh);

  // 3. Door Knob / Handle Assembly
  const knobLatchInset = 0.07;
  const knobLocalX = hingeSide === 'left' ? leafWidth - knobLatchInset : -(leafWidth - knobLatchInset);
  const knobGroup = new Group();
  knobGroup.name = 'door-knob-assembly';
  knobGroup.position.set(knobLocalX, knobHeight, 0);
  hingeGroup.add(knobGroup);

  // Rose escutcheon plates on front (+Z) and back (-Z)
  const roseGeom = new CylinderGeometry(0.03, 0.03, 0.008, 12);
  geometries.push(roseGeom);
  for (const sign of [-1, 1]) {
    const roseMesh = new Mesh(roseGeom, knobMaterial);
    roseMesh.rotation.x = Math.PI / 2;
    roseMesh.position.set(0, 0, sign * (leafThickness / 2 + 0.004));
    roseMesh.castShadow = castShadow;
    knobGroup.add(roseMesh);
  }

  if (knobStyle === 'lever') {
    const leverGeom = new BoxGeometry(0.11, 0.018, 0.02);
    geometries.push(leverGeom);
    for (const sign of [-1, 1]) {
      const leverMesh = new Mesh(leverGeom, knobMaterial);
      const leverDir = hingeSide === 'left' ? -1 : 1;
      leverMesh.position.set(leverDir * 0.045, 0, sign * (leafThickness / 2 + 0.035));
      leverMesh.castShadow = castShadow;
      knobGroup.add(leverMesh);
    }
  } else {
    // Round knob
    const knobGeom = new SphereGeometry(0.026, 12, 10);
    geometries.push(knobGeom);
    for (const sign of [-1, 1]) {
      const knobMesh = new Mesh(knobGeom, knobMaterial);
      knobMesh.position.set(0, 0, sign * (leafThickness / 2 + 0.035));
      knobMesh.castShadow = castShadow;
      knobGroup.add(knobMesh);
    }
  }

  let currentAngle = 0;
  const maxAngle = DEFAULT_MAX_ANGLE;

  const setOpenAngle = (angleRad: number): void => {
    currentAngle = Math.max(0, Math.min(maxAngle, angleRad));
    // To swing the door forward into +Z:
    // Left hinge: leaf is along +X, clockwise rotation (-Y) swings +X towards +Z.
    // Right hinge: leaf is along -X, counter-clockwise rotation (+Y) swings -X towards +Z.
    const sign = hingeSide === 'left' ? -1 : 1;
    hingeGroup.rotation.y = sign * currentAngle;
  };

  const getOpenAngle = (): number => currentAngle;

  const getKnobWorldPos = (worldMat: Matrix4): Vector3 => {
    root.updateMatrixWorld(true);
    const local = new Vector3();
    knobGroup.getWorldPosition(local);
    if (worldMat !== root.matrixWorld) {
      const localToRoot = knobGroup.position.clone();
      localToRoot.applyEuler(hingeGroup.rotation);
      localToRoot.add(hingeGroup.position);
      return localToRoot.applyMatrix4(worldMat);
    }
    return local;
  };

  const getDoorAffordance = (worldMatrix?: Matrix4): CharacterDoorAffordance => {
    const mat = worldMatrix ?? root.matrixWorld;
    if (!worldMatrix) {
      root.updateMatrixWorld(true);
    }

    const knobPos = getKnobWorldPos(mat);
    // Approach position stands ~0.45m in front of the door knob on the front side (+Z)
    const forwardVec = new Vector3(0, 0, 0.45).transformDirection(mat);
    const approachPos = knobPos.clone().add(forwardVec);
    approachPos.y = mat.elements[13]; // ground level of door

    const affordance: CharacterDoorAffordance = {
      id: `door-${root.id}`,
      knobPosition: characterVector3(knobPos.x, knobPos.y, knobPos.z),
      approachPosition: characterVector3(approachPos.x, approachPos.y, approachPos.z),
      hingeSide,
      isOpen: currentAngle > 0.08,
      openAngleRad: currentAngle,
      maxAngleRad: maxAngle,
    };
    validateDoorAffordance(affordance);
    return affordance;
  };

  const getKnobReachAffordance = (worldMatrix?: Matrix4): CharacterReachAffordance => {
    const mat = worldMatrix ?? root.matrixWorld;
    if (!worldMatrix) {
      root.updateMatrixWorld(true);
    }

    const knobPos = getKnobWorldPos(mat);
    const forwardVec = new Vector3(0, 0, 0.45).transformDirection(mat);
    const approachPos = knobPos.clone().add(forwardVec);
    approachPos.y = mat.elements[13];

    const affordance: CharacterReachAffordance = {
      id: `door-knob-reach-${root.id}`,
      targetPosition: characterVector3(knobPos.x, knobPos.y, knobPos.z),
      approachPosition: characterVector3(approachPos.x, approachPos.y, approachPos.z),
      gripType: knobStyle === 'lever' ? 'handle' : 'knob',
      handPreference: hingeSide === 'left' ? 'right' : 'left',
    };
    validateReachAffordance(affordance);
    return affordance;
  };

  const initialDoorAffordance = getDoorAffordance();
  const initialKnobReachAffordance = getKnobReachAffordance();

  const dispose = (): void => {
    geometries.forEach((g) => g.dispose());
    frameMaterial.dispose();
    doorMaterial.dispose();
    knobMaterial.dispose();
  };

  return {
    group: root,
    hingeGroup,
    doorAffordance: initialDoorAffordance,
    knobReachAffordance: initialKnobReachAffordance,
    setOpenAngle,
    getOpenAngle,
    getDoorAffordance,
    getKnobReachAffordance,
    dispose,
  };
}
