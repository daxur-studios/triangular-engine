import {
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  CapsuleGeometry,
  CylinderGeometry,
  DoubleSide,
  Line,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  MeshPhongMaterial,
  Quaternion,
  Scene,
  SphereGeometry,
  Vector3,
} from 'three';
// WASM embedded in the bundle, debug checking enabled (outputs errors to the console and enables the debug renderer)
import Jolt from 'jolt-physics/wasm-compat';

let settings: Jolt.JoltSettings;

// Timers
var time = 0;

// Physics variables
var jolt: Jolt.JoltInterface;
var physicsSystem;
//export var bodyInterface: Jolt.BodyInterface;

// List of objects spawned
//export const dynamicObjects: Mesh[] = [];

// The update function
var onExampleUpdate: (time: number, deltaTime: number) => void;

export const wrapVec3 = (v: Jolt.RVec3 | Jolt.Vec3) =>
  new Vector3(v.GetX(), v.GetY(), v.GetZ());
const unwrapVec3 = (v: Vector3) => new Jolt.RVec3(v.x, v.y, v.z);
export const wrapRVec3 = wrapVec3;
const unwrapRVec3 = (v: Vector3) => new Jolt.RVec3(v.x, v.y, v.z);
export const wrapQuat = (q: Jolt.Quat) =>
  new Quaternion(q.GetX(), q.GetY(), q.GetZ(), q.GetW());
const unwrapQuat = (q: Quaternion) => new Jolt.Quat(q.x, q.y, q.z, q.w);

// Object layers
export const LAYER_NON_MOVING = 0;
export const LAYER_MOVING = 1;
export const NUM_OBJECT_LAYERS = 2;

export function getRandomQuat() {
  let vec = new Jolt.Vec3(0.001 + Math.random(), Math.random(), Math.random());
  let quat = Jolt.Quat.prototype.sRotation(
    vec.Normalized(),
    2 * Math.PI * Math.random(),
  );
  Jolt.destroy(vec);
  return quat;
}

let setupCollisionFiltering = function (settings: Jolt.JoltSettings) {
  // Layer that objects can be in, determines which other objects it can collide with
  // Typically you at least want to have 1 layer for moving bodies and 1 layer for static bodies, but you can have more
  // layers if you want. E.g. you could have a layer for high detail collision (which is not used by the physics simulation
  // but only if you do collision testing).
  let objectFilter = new Jolt.ObjectLayerPairFilterTable(NUM_OBJECT_LAYERS);
  objectFilter.EnableCollision(LAYER_NON_MOVING, LAYER_MOVING);
  objectFilter.EnableCollision(LAYER_MOVING, LAYER_MOVING);

  // Each broadphase layer results in a separate bounding volume tree in the broad phase. You at least want to have
  // a layer for non-moving and moving objects to avoid having to update a tree full of static objects every frame.
  // You can have a 1-on-1 mapping between object layers and broadphase layers (like in this case) but if you have
  // many object layers you'll be creating many broad phase trees, which is not efficient.
  const BP_LAYER_NON_MOVING = new Jolt.BroadPhaseLayer(0);
  const BP_LAYER_MOVING = new Jolt.BroadPhaseLayer(1);
  const NUM_BROAD_PHASE_LAYERS = 2;
  let bpInterface = new Jolt.BroadPhaseLayerInterfaceTable(
    NUM_OBJECT_LAYERS,
    NUM_BROAD_PHASE_LAYERS,
  );
  bpInterface.MapObjectToBroadPhaseLayer(LAYER_NON_MOVING, BP_LAYER_NON_MOVING);
  bpInterface.MapObjectToBroadPhaseLayer(LAYER_MOVING, BP_LAYER_MOVING);

  settings.mObjectLayerPairFilter = objectFilter;
  settings.mBroadPhaseLayerInterface = bpInterface;
  settings.mObjectVsBroadPhaseLayerFilter =
    new Jolt.ObjectVsBroadPhaseLayerFilterTable(
      settings.mBroadPhaseLayerInterface,
      NUM_BROAD_PHASE_LAYERS,
      settings.mObjectLayerPairFilter,
      NUM_OBJECT_LAYERS,
    );
};

function initPhysics() {
  // Initialize Jolt
  settings = new Jolt.JoltSettings();
  settings.mMaxWorkerThreads = 3; // Limit the number of worker threads to 3 (for a total of 4 threads working on the simulation). Note that this value will always be clamped against the number of CPUs in the system - 1.
  setupCollisionFiltering(settings);
  jolt = new Jolt.JoltInterface(settings);
  Jolt.destroy(settings);
  physicsSystem = jolt.GetPhysicsSystem();
  //bodyInterface = physicsSystem.GetBodyInterface();
}

function updatePhysics(deltaTime: number) {
  // When running below 55 Hz, do 2 steps instead of 1
  var numSteps = deltaTime > 1.0 / 55.0 ? 2 : 1;

  // Step the physics world
  jolt.Step(deltaTime, numSteps);
}

export function initExample(
  joltModule: typeof Jolt,
  updateFunction: (time: number, deltaTime: number) => void,
) {
  Object.assign(Jolt, joltModule);
  (window as any).Jolt = Jolt;

  onExampleUpdate = updateFunction;

  initPhysics();
  //renderExampleTick(0, dynamicObjects);
}

export function renderExampleTick(deltaTime: number, dynamicObjects: Mesh[]) {
  // Don't go below 30 Hz to prevent spiral of death
  //var deltaTime = clock.getDelta();
  deltaTime = Math.min(deltaTime, 1.0 / 30.0);

  if (onExampleUpdate != null) onExampleUpdate(time, deltaTime);

  // Update object transforms
  for (let i = 0, il = dynamicObjects.length; i < il; i++) {
    let objThree = dynamicObjects[i];
    let body = objThree.userData['body'];
    objThree.position.copy(wrapVec3(body.GetPosition()));
    objThree.quaternion.copy(wrapQuat(body.GetRotation()));

    if (body.GetBodyType() == Jolt.EBodyType_SoftBody) {
      if (objThree.userData['updateVertex']) {
        objThree.userData['updateVertex']();
      } else {
        objThree.geometry = createMeshForShape(body.GetShape());
      }
    }
  }

  time += deltaTime;

  updatePhysics(deltaTime);
}

function addToThreeScene(
  dynamicObjects: Mesh[],
  scene: Scene,
  body: Jolt.Body,
  color: number,
) {
  let threeObject = getThreeObjectForBody(body, color);
  threeObject.userData['body'] = body;

  scene.add(threeObject);
  dynamicObjects.push(threeObject);
}

export function addToScene(
  dynamicObjects: Mesh[],
  bodyInterface: Jolt.BodyInterface,
  scene: Scene,
  body: Jolt.Body,
  color: number,
) {
  bodyInterface.AddBody(body.GetID(), Jolt.EActivation_Activate);

  addToThreeScene(dynamicObjects, scene, body, color);
}

export function removeFromScene(
  dynamicObjects: Mesh[],
  bodyInterface: Jolt.BodyInterface,
  scene: Scene,
  threeObject: Mesh,
) {
  let id = threeObject.userData['body'].GetID();
  bodyInterface.RemoveBody(id);
  bodyInterface.DestroyBody(id);
  delete threeObject.userData['body'];

  scene.remove(threeObject);
  let idx = dynamicObjects.indexOf(threeObject);
  dynamicObjects.splice(idx, 1);
}

export function createFloor(
  dynamicObjects: Mesh[],
  bodyInterface: Jolt.BodyInterface,
  scene: Scene,
  size = 50,
) {
  var shape = new Jolt.BoxShape(
    new Jolt.Vec3(size, 0.5, size),
    0.05,
    undefined,
  );
  var creationSettings = new Jolt.BodyCreationSettings(
    shape,
    new Jolt.RVec3(0, -0.5, 0),
    new Jolt.Quat(0, 0, 0, 1),
    Jolt.EMotionType_Static,
    LAYER_NON_MOVING,
  );
  let body = bodyInterface.CreateBody(creationSettings);
  Jolt.destroy(creationSettings);
  addToScene(dynamicObjects, bodyInterface, scene, body, 0xc7c7c7);
  return body;
}

export function createBox(
  dynamicObjects: Mesh[],
  bodyInterface: Jolt.BodyInterface,
  scene: Scene,
  position: Jolt.RVec3,
  rotation: Jolt.Quat,
  halfExtent: Jolt.Vec3,
  motionType: Jolt.EMotionType,
  layer: number,
  color = 0xffffff,
) {
  let shape = new Jolt.BoxShape(halfExtent, 0.05, undefined);
  let creationSettings = new Jolt.BodyCreationSettings(
    shape,
    position,
    rotation,
    motionType,
    layer,
  );
  let body = bodyInterface.CreateBody(creationSettings);
  Jolt.destroy(creationSettings);
  addToScene(dynamicObjects, bodyInterface, scene, body, color);
  return body;
}

export function createSphere(
  dynamicObjects: Mesh[],
  bodyInterface: Jolt.BodyInterface,
  scene: Scene,
  position: Jolt.RVec3,
  radius: number,
  motionType: Jolt.EMotionType,
  layer: number,
  color = 0xffffff,
) {
  let shape = new Jolt.SphereShape(radius, undefined);
  let creationSettings = new Jolt.BodyCreationSettings(
    shape,
    position,
    Jolt.Quat.prototype.sIdentity(),
    motionType,
    layer,
  );
  let body = bodyInterface.CreateBody(creationSettings);
  Jolt.destroy(creationSettings);
  addToScene(dynamicObjects, bodyInterface, scene, body, color);
  return body;
}

export function createMeshForShape(shape: Jolt.Shape) {
  // Get triangle data
  let scale = new Jolt.Vec3(1, 1, 1);
  let triContext = new Jolt.ShapeGetTriangles(
    shape,
    Jolt.AABox.prototype.sBiggest(),
    shape.GetCenterOfMass(),
    Jolt.Quat.prototype.sIdentity(),
    scale,
  );
  Jolt.destroy(scale);

  // Get a view on the triangle data (does not make a copy)
  let vertices = new Float32Array(
    Jolt.HEAPF32.buffer,
    triContext.GetVerticesData(),
    triContext.GetVerticesSize() / Float32Array.BYTES_PER_ELEMENT,
  );

  // Now move the triangle data to a buffer and clone it so that we can free the memory from the C++ heap (which could be limited in size)
  let buffer = new BufferAttribute(vertices, 3).clone();
  Jolt.destroy(triContext);

  // Create a three mesh
  let geometry = new BufferGeometry();
  geometry.setAttribute('position', buffer);
  geometry.computeVertexNormals();

  return geometry;
}

function getSoftBodyMesh(body: Jolt.Body, material: MeshPhongMaterial) {
  const motionProperties = Jolt.castObject(
    body.GetMotionProperties(),
    Jolt.SoftBodyMotionProperties,
  );
  const vertexSettings = motionProperties.GetVertices();
  const settings = motionProperties.GetSettings();
  const positionOffset = Jolt.SoftBodyVertexTraits.prototype.mPositionOffset;
  const faceData = settings.mFaces;

  // Get a view on the triangle data
  const softVertex: Float32Array[] = [];
  for (let i = 0; i < vertexSettings.size(); i++) {
    softVertex.push(
      new Float32Array(
        Jolt.HEAP32.buffer,
        Jolt.getPointer(vertexSettings.at(i)) + positionOffset,
        3,
      ),
    );
  }

  // Define faces (indices of vertices for the triangles)
  const faces = new Uint32Array(faceData.size() * 3);
  for (let i = 0; i < faceData.size(); i++) {
    faces.set(
      new Uint32Array(Jolt.HEAP32.buffer, Jolt.getPointer(faceData.at(i)), 3),
      i * 3,
    );
  }

  // Create a three mesh
  let geometry = new BufferGeometry();
  let vertices = new Float32Array(vertexSettings.size() * 3);
  geometry.setAttribute('position', new BufferAttribute(vertices, 3));
  geometry.setIndex(new BufferAttribute(faces, 1));
  material.side = DoubleSide;
  const threeObject = new Mesh(geometry, material);
  threeObject.userData['updateVertex'] = () => {
    for (let i = 0; i < softVertex.length; i++) {
      vertices.set(softVertex[i], i * 3);
    }
    geometry.computeVertexNormals();
    geometry.getAttribute('position').needsUpdate = true;
    geometry.getAttribute('normal').needsUpdate = true;
  };
  threeObject.userData['updateVertex']();
  return threeObject;
}

function getThreeObjectForBody(body: Jolt.Body, color: number) {
  let material = new MeshPhongMaterial({ color: color });

  let threeObject;

  let shape = body.GetShape();
  switch (shape.GetSubType()) {
    case Jolt.EShapeSubType_Box:
      let boxShape = Jolt.castObject(shape, Jolt.BoxShape);
      let extent = wrapVec3(boxShape.GetHalfExtent()).multiplyScalar(2);
      threeObject = new Mesh(
        new BoxGeometry(extent.x, extent.y, extent.z, 1, 1, 1),
        material,
      );
      break;
    case Jolt.EShapeSubType_Sphere:
      let sphereShape = Jolt.castObject(shape, Jolt.SphereShape);
      threeObject = new Mesh(
        new SphereGeometry(sphereShape.GetRadius(), 32, 32),
        material,
      );
      break;
    case Jolt.EShapeSubType_Capsule:
      let capsuleShape = Jolt.castObject(shape, Jolt.CapsuleShape);
      threeObject = new Mesh(
        new CapsuleGeometry(
          capsuleShape.GetRadius(),
          2 * capsuleShape.GetHalfHeightOfCylinder(),
          20,
          10,
        ),
        material,
      );
      break;
    case Jolt.EShapeSubType_Cylinder:
      let cylinderShape = Jolt.castObject(shape, Jolt.CylinderShape);
      threeObject = new Mesh(
        new CylinderGeometry(
          cylinderShape.GetRadius(),
          cylinderShape.GetRadius(),
          2 * cylinderShape.GetHalfHeight(),
          20,
          1,
        ),
        material,
      );
      break;
    default:
      if (body.GetBodyType() == Jolt.EBodyType_SoftBody)
        threeObject = getSoftBodyMesh(body, material);
      else threeObject = new Mesh(createMeshForShape(shape), material);
      break;
  }

  threeObject.position.copy(wrapVec3(body.GetPosition()));
  threeObject.quaternion.copy(wrapQuat(body.GetRotation()));

  return threeObject;
}

export function createMeshFloor(
  dynamicObjects: Mesh[],
  bodyInterface: Jolt.BodyInterface,
  scene: Scene,
  n: number,
  cellSize: number,
  maxHeight: number,
  posX: number,
  posY: number,
  posZ: number,
) {
  // Create regular grid of triangles
  let height = function (x: number, y: number) {
    return Math.sin(x / 2) * Math.cos(y / 3);
  };
  let triangles = new Jolt.TriangleList();
  triangles.resize(n * n * 2);
  for (let x = 0; x < n; ++x)
    for (let z = 0; z < n; ++z) {
      let center = (n * cellSize) / 2;

      let x1 = cellSize * x - center;
      let z1 = cellSize * z - center;
      let x2 = x1 + cellSize;
      let z2 = z1 + cellSize;

      {
        let t = triangles.at((x * n + z) * 2);
        let v1 = t.get_mV(0),
          v2 = t.get_mV(1),
          v3 = t.get_mV(2);
        (v1.x = x1), (v1.y = height(x, z)), (v1.z = z1);
        (v2.x = x1), (v2.y = height(x, z + 1)), (v2.z = z2);
        (v3.x = x2), (v3.y = height(x + 1, z + 1)), (v3.z = z2);
      }

      {
        let t = triangles.at((x * n + z) * 2 + 1);
        let v1 = t.get_mV(0),
          v2 = t.get_mV(1),
          v3 = t.get_mV(2);
        (v1.x = x1), (v1.y = height(x, z)), (v1.z = z1);
        (v2.x = x2), (v2.y = height(x + 1, z + 1)), (v2.z = z2);
        (v3.x = x2), (v3.y = height(x + 1, z)), (v3.z = z1);
      }
    }
  let materials = new Jolt.PhysicsMaterialList();
  let shape = new Jolt.MeshShapeSettings(triangles, materials).Create().Get();
  Jolt.destroy(triangles);
  Jolt.destroy(materials);

  // Create body
  let creationSettings = new Jolt.BodyCreationSettings(
    shape,
    new Jolt.RVec3(posX, posY, posZ),
    new Jolt.Quat(0, 0, 0, 1),
    Jolt.EMotionType_Static,
    LAYER_NON_MOVING,
  );
  let body = bodyInterface.CreateBody(creationSettings);
  Jolt.destroy(creationSettings);
  addToScene(dynamicObjects, bodyInterface, scene, body, 0xc7c7c7);
}
