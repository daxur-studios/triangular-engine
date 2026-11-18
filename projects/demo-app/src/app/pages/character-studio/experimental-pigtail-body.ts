import {
  Box3, CatmullRomCurve3, Group, LatheGeometry, Mesh, MeshStandardMaterial,
  SphereGeometry, TubeGeometry, Vector2, Vector3,
  type BufferGeometry, type Material,
} from 'three';

type Vec3 = readonly [number, number, number];
type ProfilePoint = readonly [number, number];

/** Matches `experimental-pigtail-head`'s local head scale (`0.35`) in blockout units. */
const HEAD_LOCAL_SCALE = 0.35;
/** Fits the full-body figure comfortably on the Character Studio pedestal alongside standard humans. */
const STUDIO_SCALE = 0.55;
const HEAD_SOCKET_Y = 7.95;

/** Shared standing spacesuit body from the approved full-body blockout with a collar socket for the seeded pigtail heads. */
export function buildExperimentalPigtailBody() {
  const root = new Group();
  root.name = 'pigtail-standing-body';
  root.scale.setScalar(STUDIO_SCALE);

  const body = new Group();
  body.scale.setScalar(HEAD_LOCAL_SCALE);
  root.add(body);

  const headSocket = new Group();
  headSocket.position.y = HEAD_SOCKET_Y * HEAD_LOCAL_SCALE;
  root.add(headSocket);

  const sphere = new SphereGeometry(1, 36, 24);
  const geometries: BufferGeometry[] = [sphere];
  const mat = (color: number) => new MeshStandardMaterial({ color, roughness: .74 });
  const suit = mat(0xe6d5bd);
  const charcoal = mat(0x3c393a);
  const soles = mat(0x403936);
  const pack = mat(0xc45e25);
  const badge = mat(0xf48125);
  const fixture = mat(0x8f8374);
  const materials: Material[] = [suit, charcoal, soles, pack, badge, fixture];

  function ellipsoid(parent: Group, material: Material, position: Vec3, radii: Vec3): Mesh {
    const mesh = new Mesh(sphere, material);
    mesh.position.set(...position);
    mesh.scale.set(...radii);
    parent.add(mesh);
    return mesh;
  }

  function profile(parent: Group, material: Material, points: readonly ProfilePoint[], position: Vec3, depth = 1): Mesh {
    const curve = new CatmullRomCurve3(points.map(([radius, y]) => new Vector3(radius, y, 0)));
    const contour = curve.getPoints(64).map(({ x, y }) => new Vector2(Math.max(0, x), y));
    const geometry = new LatheGeometry(contour, 64);
    geometries.push(geometry);
    const mesh = new Mesh(geometry, material);
    mesh.position.set(...position);
    mesh.scale.z = depth;
    parent.add(mesh);
    return mesh;
  }

  function limb(parent: Group, material: Material, points: readonly Vec3[], radius: number): Mesh {
    const curve = new CatmullRomCurve3(points.map(point => new Vector3(...point)));
    const geometry = new TubeGeometry(curve, 22, radius, 18, false);
    geometries.push(geometry);
    const mesh = new Mesh(geometry, material);
    parent.add(mesh);
    return mesh;
  }

  // Suit and head meet at nearly the same diameter beneath the collar.
  const torso = profile(body, suit, [
    [0, 4.26], [.62, 4.29], [1.14, 4.47], [1.48, 4.86],
    [1.60, 5.34], [1.60, 6.38], [1.48, 7.39], [1.35, 7.78], [0, 7.79],
  ], [0, 0, 0], .97);
  torso.name = 'pigtail-torso';

  const collar = profile(body, charcoal, [
    [0, -.27], [1.38, -.27], [1.56, -.22], [1.66, -.06],
    [1.67, .13], [1.55, .25], [1.35, .26], [0, .26],
  ], [0, 7.84, 0], 1.01);
  collar.name = 'pigtail-collar';

  const patch = ellipsoid(body, badge, [.35, 6.77, 1.47], [.36, .36, .13]);
  patch.name = 'pigtail-badge';
  patch.rotation.y = .17;

  // The pack sits behind the shoulder rings. The two nozzles stay above the hips.
  const packZ = -2.18;
  ellipsoid(body, charcoal, [0, 6.46, -1.30], [.86, 1.27, .45]);
  const backpack = profile(body, pack, [
    [0, 4.84], [.69, 4.89], [1.04, 5.16], [1.18, 5.50],
    [1.18, 7.85], [1.12, 8.31], [.85, 8.52], [.45, 8.62], [0, 8.63],
  ], [0, 0, packZ], .87);
  backpack.name = 'pigtail-backpack';

  profile(body, charcoal, [
    [0, -.08], [1.16, -.08], [1.22, -.03], [1.22, .11], [1.17, .15], [0, .15],
  ], [0, 5.32, packZ], .88);

  for (const side of [-1, 1] as const) {
    const sideLabel = side === -1 ? 'left' : 'right';
    const nozzle: Vec3 = [side * .59, 4.57, packZ - .12];
    profile(body, fixture, [[0, -.19], [.35, -.19], [.38, -.14], [.28, .09], [.24, .48], [0, .50]], nozzle);
    profile(body, soles, [[0, -.03], [.32, -.03], [.33, 0], [.32, .05], [0, .05]], [nozzle[0], 4.71, nozzle[2]]);
    ellipsoid(body, fixture, [side * 1.14, 6.49, packZ - .12], [.14, .62, .49]);
    for (const y of [6.87, 6.47]) {
      ellipsoid(body, charcoal, [side * 1.26, y - .13, packZ - .12], [.05, .125, .135]);
    }

    const shoulder: Vec3 = [side * 1.44, 6.95, .07];
    const elbow: Vec3 = [side * 2.03, 6.11, .11];
    const wrist: Vec3 = [side * 2.31, 4.98, .18];
    ellipsoid(body, charcoal, shoulder, [.38, .74, .65]).rotation.z = side * .27;
    limb(body, suit, [shoulder, elbow, wrist], .275).name = `pigtail-arm-${sideLabel}`;
    ellipsoid(body, charcoal, wrist, [.43, .21, .40]).rotation.z = -side * .16;

    const palm = new Group();
    palm.name = `pigtail-hand-${sideLabel}`;
    palm.position.set(...wrist);
    palm.rotation.set(.10, side * .28, -side * .13);
    palm.scale.set(1.23, 1.24, 1.21);
    ellipsoid(palm, charcoal, [0, -.40, 0], [.37, .49, .29]);
    ellipsoid(palm, charcoal, [-side * .30, -.57, .13], [.18, .34, .16]).rotation.z = -side * .39;
    for (const [offset, length] of [[-.18, .31], [0, .36], [.17, .30]] as const) {
      ellipsoid(palm, charcoal, [side * offset, -.79, .045], [.125, length, .18]).rotation.z = -side * .11;
    }
    body.add(palm);

    const ankleX = side === -1 ? -1.25 : 1.00;
    const ankleZ = side === -1 ? -.12 : -.03;
    limb(body, charcoal, [
      [side * .66, 4.52, -.03], [ankleX * .70, 3.19, ankleZ * .55],
      [ankleX, 1.46, ankleZ],
    ], .245).name = `pigtail-leg-${sideLabel}`;

    const foot = new Group();
    foot.name = `pigtail-boot-${sideLabel}`;
    foot.position.set(ankleX, 0, ankleZ);
    foot.rotation.y = side === -1 ? -.52 : .52;
    foot.scale.set(1.19, 1.25, 1.11);
    profile(foot, soles, [
      [0, 0], [.61, 0], [.70, .054], [.72, .18], [.66, .26], [0, .27],
    ], [0, 0, .35], 1.53);
    profile(foot, suit, [
      [0, .18], [.63, .18], [.71, .25], [.70, .40], [.63, .65], [.43, .87], [0, .93],
    ], [0, 0, .35], 1.52);
    profile(foot, suit, [
      [0, .44], [.51, .48], [.49, 1.24], [.47, 1.47], [.40, 1.54], [.24, 1.52], [.23, 1.30], [0, 1.29],
    ], [0, 0, 0]);
    body.add(foot);
  }

  // Seat the lowest point of the boot soles cleanly on the pedestal (y = 0).
  root.updateMatrixWorld(true);
  const soleMinY = new Box3().setFromObject(body, true).min.y;
  const localOffsetY = -soleMinY / STUDIO_SCALE;
  body.position.y += localOffsetY;
  headSocket.position.y += localOffsetY;
  root.updateMatrixWorld(true);

  return {
    root,
    headSocket,
    dispose: () => {
      for (const geometry of geometries) geometry.dispose();
      for (const material of materials) material.dispose();
    },
  };
}
