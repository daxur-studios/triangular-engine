import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  inject,
  signal,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import {
  BoxGeometry,
  CapsuleGeometry,
  Color,
  CylinderGeometry,
  DoubleSide,
  ExtrudeGeometry,
  GridHelper,
  Group,
  Mesh,
  MeshStandardMaterial,
  Shape,
  ShapeGeometry,
  SphereGeometry,
} from 'three';
import { SVGLoader } from 'three/examples/jsm/loaders/SVGLoader.js';
import { EngineModule, EngineService } from 'triangular-engine';

export interface ICharacterAttempt {
  readonly id: string;
  readonly label: string;
  readonly technique: string;
  readonly description: string;
  readonly x: number;
}

interface IAttemptDefinition extends ICharacterAttempt {
  readonly build: (group: Group) => void;
}

const ATTEMPT_SPACING = 2.6;

// SVG Archetype 1: Space Explorer / Cosmonaut (viewBox: 0 0 100 120)
const SVG_COSMONAUT = `
<svg viewBox="0 0 100 120" xmlns="http://www.w3.org/2000/svg">
  <!-- Oxygen backpack -->
  <rect x="26" y="32" width="48" height="42" rx="6" fill="#334155" />
  <rect x="32" y="24" width="12" height="10" rx="3" fill="#64748b" />
  <rect x="56" y="24" width="12" height="10" rx="3" fill="#64748b" />

  <!-- Legs & Boots -->
  <path d="M32,70 L46,70 L44,106 L30,106 Z" fill="#cbd5e1" />
  <path d="M28,106 L46,106 L48,118 L26,118 Z" fill="#1e293b" />
  <path d="M54,70 L68,70 L70,106 L56,106 Z" fill="#cbd5e1" />
  <path d="M54,106 L72,106 L74,118 L52,118 Z" fill="#1e293b" />
  <rect x="30" y="88" width="15" height="4" fill="#f97316" />
  <rect x="55" y="88" width="15" height="4" fill="#f97316" />

  <!-- Spacesuit Torso -->
  <path d="M28,38 L72,38 L68,76 L32,76 Z" fill="#e2e8f0" />
  <rect x="28" y="72" width="44" height="6" rx="2" fill="#475569" />
  <circle cx="50" cy="75" r="3" fill="#f97316" />

  <!-- Arms & Gloves -->
  <path d="M28,38 L14,64 L22,68 L32,46 Z" fill="#cbd5e1" />
  <circle cx="16" cy="68" r="6" fill="#1e293b" />
  <path d="M72,38 L86,64 L78,68 L68,46 Z" fill="#cbd5e1" />
  <circle cx="84" cy="68" r="6" fill="#1e293b" />

  <!-- Chest Control Console -->
  <rect x="38" y="46" width="24" height="18" rx="3" fill="#1e293b" />
  <rect x="42" y="50" width="6" height="4" fill="#38bdf8" />
  <rect x="52" y="50" width="6" height="4" fill="#22c55e" />
  <circle cx="45" cy="59" r="2" fill="#ef4444" />
  <circle cx="55" cy="59" r="2" fill="#eab308" />

  <!-- Helmet & Visor -->
  <circle cx="50" cy="22" r="18" fill="#f8fafc" />
  <ellipse cx="50" cy="22" rx="13" ry="10" fill="#0284c7" />
  <path d="M42,16 Q54,14 58,19 Q48,17 42,16 Z" fill="#bae6fd" />
</svg>
`;

// SVG Archetype 2: Industrial Scrap-Bot / Mining Mech (viewBox: 0 0 100 120)
// data-depth = per-part extrusion thickness in meters (default 0.5)
const SVG_SCRAP_BOT = `
<svg viewBox="0 0 100 120" xmlns="http://www.w3.org/2000/svg">
  <!-- Power Pack / Chimney -->
  <rect x="24" y="22" width="52" height="46" rx="4" fill="#1e293b" />
  <rect x="30" y="10" width="8" height="14" fill="#475569" data-depth="0.3" />
  <rect x="62" y="10" width="8" height="14" fill="#475569" data-depth="0.3" />

  <!-- Heavy Piston Legs & Feet -->
  <rect x="30" y="70" width="14" height="34" fill="#475569" data-depth="0.25" />
  <rect x="24" y="104" width="22" height="14" rx="3" fill="#0f172a" data-depth="0.32" />
  <rect x="56" y="70" width="14" height="34" fill="#475569" data-depth="0.25" />
  <rect x="54" y="104" width="22" height="14" rx="3" fill="#0f172a" data-depth="0.32" />

  <!-- Heavy Armored Chassis -->
  <rect x="24" y="34" width="52" height="40" rx="4" fill="#eab308" />
  <!-- Hazard Stripes -->
  <path d="M30,62 L38,62 L46,70 L38,70 Z" fill="#1e293b" data-depth="0.54" />
  <path d="M46,62 L54,62 L62,70 L54,70 Z" fill="#1e293b" data-depth="0.54" />
  <path d="M62,62 L70,62 L70,70 L62,70 Z" fill="#1e293b" data-depth="0.54" />

  <!-- Heavy Shoulders & Hydraulic Arms -->
  <rect x="12" y="34" width="14" height="12" rx="3" fill="#64748b" data-depth="0.4" />
  <path d="M16,46 L14,72 L22,76 L24,46 Z" fill="#475569" data-depth="0.25" />
  <path d="M10,74 L24,74 L26,86 L8,86 Z" fill="#0f172a" data-depth="0.32" />

  <rect x="74" y="34" width="14" height="12" rx="3" fill="#64748b" data-depth="0.4" />
  <path d="M84,46 L86,72 L78,76 L76,46 Z" fill="#475569" data-depth="0.25" />
  <path d="M76,74 L90,74 L92,86 L74,86 Z" fill="#0f172a" data-depth="0.32" />

  <!-- Robot Head & Sensor Array -->
  <rect x="32" y="14" width="36" height="22" rx="3" fill="#334155" data-depth="0.45" />
  <!-- Glowing Optic Visor -->
  <rect x="36" y="20" width="28" height="8" rx="2" fill="#22c55e" data-depth="0.5" />
  <circle cx="50" cy="24" r="3" fill="#86efac" data-depth="0.52" />
  <circle cx="38" cy="17" r="2" fill="#ef4444" data-depth="0.52" />
</svg>
`;

// SVG Archetype 3: Cyber Synth / Neon Runner (viewBox: 0 0 100 120)
const SVG_NEON_RUNNER = `
<svg viewBox="0 0 100 120" xmlns="http://www.w3.org/2000/svg">
  <!-- Tech Trench / Backing Cloak -->
  <path d="M22,34 L78,34 L84,98 L72,98 L68,46 L32,46 L28,98 L16,98 Z" fill="#0f172a" />

  <!-- Sleek Cybernetic Legs -->
  <path d="M34,68 L46,68 L44,116 L32,116 Z" fill="#1e293b" />
  <path d="M30,112 L46,112 L48,118 L28,118 Z" fill="#0284c7" />
  <path d="M54,68 L66,68 L68,116 L56,116 Z" fill="#1e293b" />
  <path d="M54,112 L70,112 L72,118 L52,118 Z" fill="#0284c7" />
  <path d="M34,84 L44,84 L43,87 L35,87 Z" fill="#ec4899" />
  <path d="M56,84 L66,84 L65,87 L57,87 Z" fill="#ec4899" />

  <!-- Armored Torso -->
  <path d="M28,36 L72,36 L66,72 L34,72 Z" fill="#1e293b" />
  <path d="M34,40 L66,40 L62,66 L38,66 Z" fill="#334155" />

  <!-- Neon Glowing Energy Core -->
  <polygon points="50,46 58,56 42,56" fill="#06b6d4" />
  <circle cx="50" cy="53" r="2" fill="#e0f2fe" />

  <!-- Arms & Tech Bracers -->
  <path d="M26,38 L14,66 L22,70 L32,44 Z" fill="#1e293b" />
  <rect x="14" y="58" width="10" height="8" rx="2" fill="#ec4899" />
  <path d="M74,38 L86,66 L78,70 L68,44 Z" fill="#1e293b" />
  <rect x="76" y="58" width="10" height="8" rx="2" fill="#ec4899" />

  <!-- Cybernetic Mask & Neon Visor Slit -->
  <polygon points="36,12 64,12 62,32 50,38 38,32" fill="#0f172a" />
  <polygon points="38,20 62,20 58,26 50,28 42,26" fill="#f43f5e" />
  <line x1="42" y1="23" x2="58" y2="23" stroke="#fecdd3" stroke-width="1.5" />
</svg>
`;

@Component({
  selector: 'app-character-lab-page',
  imports: [RouterLink, EngineModule],
  templateUrl: './character-lab-page.component.html',
  styleUrl: './character-lab-page.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [EngineService.provide({ showFPS: true })],
  host: { class: 'flex-page' },
})
export class CharacterLabPageComponent {
  private readonly engine = inject(EngineService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly svgLoader = new SVGLoader();

  readonly attempts = signal<readonly ICharacterAttempt[]>([]);
  readonly selectedAttemptId = signal('svg-flat-cutout');
  readonly logarithmicDepthBuffer = signal<boolean>(false);

  readonly selectedAttempt = computed<ICharacterAttempt | undefined>(() => {
    return this.attempts().find((a) => a.id === this.selectedAttemptId());
  });

  readonly activeTarget = computed<[number, number, number]>(() => {
    const selected = this.selectedAttempt();
    return selected ? [selected.x, 1.05, 0] : [0, 1.05, 0];
  });

  private readonly rootGroup = new Group();

  constructor() {
    const grid = new GridHelper(28, 28, 0x3b4758, 0x1e2736);
    grid.position.y = 0.001;
    this.rootGroup.add(grid);
    this.engine.scene.add(this.rootGroup);

    this.registerAttempts();

    this.destroyRef.onDestroy(() => this.rootGroup.clear());
  }

  selectAttempt(id: string): void {
    this.selectedAttemptId.set(id);
  }

  toggleLogarithmicDepthBuffer(): void {
    this.logarithmicDepthBuffer.update((v) => !v);
  }

  private registerAttempts(): void {
    const defs: readonly IAttemptDefinition[] = [
      {
        id: 'capsule-person',
        label: 'Capsule Person',
        technique: 'Procedural 3D Primitive',
        description: 'Baseline minimal capsule & sphere mesh with simple standard materials.',
        x: -ATTEMPT_SPACING * 2,
        build: (group) => this.buildCapsulePerson(group),
      },
      {
        id: 'box-robot',
        label: 'Box Robot',
        technique: 'Blocky 3D Primitive',
        description: 'Baseline volumetric box anatomy for deterministic low-poly bots.',
        x: -ATTEMPT_SPACING,
        build: (group) => this.buildBoxRobot(group),
      },
      {
        id: 'svg-flat-cutout',
        label: 'SVG Flat Cutout',
        technique: '2.5D Layered ShapeGeometry',
        description: 'Vector-crisp standee with micro z-offsets, double-sided materials, and realistic 3D shadows.',
        x: 0,
        build: (group) => this.buildSvgFlatCutout(group, SVG_COSMONAUT),
      },
      {
        id: 'svg-extruded-toy',
        label: 'SVG Extruded Figurine',
        technique: 'Beveled 3D ExtrudeGeometry',
        description: 'Chunky tactile figurine with per-part extrusion depths, rounded bevels, metallic chassis, and glossy highlights.',
        x: ATTEMPT_SPACING,
        build: (group) => this.buildSvgExtrudedToy(group, SVG_SCRAP_BOT),
      },
      {
        id: 'svg-layered-diorama',
        label: 'SVG Layered Diorama',
        technique: 'Multi-Depth Relief + Emissive Glow',
        description: 'Tiered depth relief with dark silhouette backing and light-emitting neon visors and power core.',
        x: ATTEMPT_SPACING * 2,
        build: (group) => this.buildSvgLayeredDiorama(group, SVG_NEON_RUNNER),
      },
    ];

    const items: ICharacterAttempt[] = [];
    for (const def of defs) {
      const group = new Group();
      group.position.x = def.x;
      def.build(group);
      this.rootGroup.add(group);
      items.push({
        id: def.id,
        label: def.label,
        technique: def.technique,
        description: def.description,
        x: def.x,
      });
    }

    this.attempts.set(items);
  }

  // --- Baseline 1: Capsule Person ---
  private buildCapsulePerson(group: Group): void {
    const bodyMat = new MeshStandardMaterial({ color: '#4f8fbf', roughness: 0.75 });
    const headMat = new MeshStandardMaterial({ color: '#e6c39a', roughness: 0.85 });

    const body = new Mesh(new CapsuleGeometry(0.34, 0.68, 4, 12), bodyMat);
    body.position.y = 0.85;
    body.castShadow = true;
    group.add(body);

    const head = new Mesh(new SphereGeometry(0.24, 24, 18), headMat);
    head.position.y = 1.58;
    head.castShadow = true;
    group.add(head);

    this.addPedestal(group, '#2a2f3a');
  }

  // --- Baseline 2: Box Robot ---
  private buildBoxRobot(group: Group): void {
    const mat = new MeshStandardMaterial({ color: '#9aa5b1', roughness: 0.4, metalness: 0.55 });

    const torso = new Mesh(new BoxGeometry(0.7, 0.8, 0.5), mat);
    torso.position.y = 1.0;
    torso.castShadow = true;
    group.add(torso);

    const head = new Mesh(new BoxGeometry(0.4, 0.35, 0.4), mat);
    head.position.y = 1.62;
    head.castShadow = true;
    group.add(head);

    this.addPedestal(group, '#2a2f3a');
  }

  // --- Style 1: SVG Flat Layered Cutout (2.5D Vector Standee) ---
  private buildSvgFlatCutout(group: Group, svgText: string): void {
    const svgData = this.svgLoader.parse(svgText);
    const targetHeight = 1.7; // ~1.7m humanoid height
    const characterGroup = new Group();

    const layerCount = svgData.paths.length;
    const zStep = 0.0025; // Small z offset to avoid z-fighting while maintaining flat profile

    svgData.paths.forEach((path, pathIndex) => {
      const fillColor = path.userData?.['style']?.['fill'];
      if (!fillColor || fillColor === 'none') return;

      const shapes: Shape[] = SVGLoader.createShapes(path);
      const color = new Color(fillColor);

      const isVisor = color.b > 0.6 && color.r < 0.3;
      const mat = new MeshStandardMaterial({
        color,
        roughness: isVisor ? 0.2 : 0.65,
        metalness: isVisor ? 0.3 : 0.08,
        side: DoubleSide,
      });

      for (const shape of shapes) {
        const geom = new ShapeGeometry(shape);
        const mesh = new Mesh(geom, mat);
        mesh.position.z = (pathIndex - layerCount / 2) * zStep;
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        characterGroup.add(mesh);
      }
    });

    // Standee slot clip at bottom
    const clipMat = new MeshStandardMaterial({ color: '#0f172a', roughness: 0.5, metalness: 0.4 });
    const slotClip = new Mesh(new BoxGeometry(0.55, 0.06, 0.1), clipMat);
    slotClip.position.set(0, 0.03, 0);
    slotClip.castShadow = true;
    characterGroup.add(slotClip);

    this.normalizeAndCenterSvgGroup(characterGroup, targetHeight);
    group.add(characterGroup);
    this.addPedestal(group, '#1e293b');
  }

  // --- Style 2: SVG Extruded Figurine (Chunky 3D Toy / Collectible) ---
  private buildSvgExtrudedToy(group: Group, svgText: string): void {
    const svgData = this.svgLoader.parse(svgText);
    const targetHeight = 1.7;
    const svgBoxHeight = 120;
    const svgScale = targetHeight / svgBoxHeight;
    const characterGroup = new Group();

    // Default slab thickness in world meters; individual parts override it
    // via a data-depth attribute on their SVG element
    const defaultDepthM = 0.5;
    // Overlapping paths extruded to identical depth z-fight on their caps,
    // so each successive path sits slightly deeper (~1mm world-space offset)
    const layerStagger = 0.15;

    svgData.paths.forEach((path, pathIndex) => {
      const fillColor = path.userData?.['style']?.['fill'];
      if (!fillColor || fillColor === 'none') return;

      const shapes: Shape[] = SVGLoader.createShapes(path);
      const color = new Color(fillColor);

      // Distinguish material properties for metallics, visors, and matte trims
      const isGlowing = (color.g > 0.7 && color.r < 0.3) || (color.r > 0.8 && color.g < 0.3);
      const isMetallic = color.r === color.g && color.g === color.b; // Grays

      const mat = new MeshStandardMaterial({
        color,
        roughness: isGlowing ? 0.1 : isMetallic ? 0.35 : 0.45,
        metalness: isMetallic ? 0.7 : 0.2,
        emissive: isGlowing ? color : new Color(0x000000),
        emissiveIntensity: isGlowing ? 0.9 : 0,
        // Parts sharing collinear SVG edges (power pack & chassis at x=24/76)
        // get coplanar side walls that no z-stagger can separate; bias depth
        // per part so later-drawn parts win, matching SVG paint order.
        // Note: ignored while logarithmicDepthBuffer is enabled.
        polygonOffset: true,
        polygonOffsetFactor: -(pathIndex + 1) * 0.05,
        polygonOffsetUnits: -(pathIndex + 1),
      });

      // Per-part thickness: data-depth is authored in world meters
      const depthAttr: string | null = path.userData?.['node']?.getAttribute?.('data-depth') ?? null;
      const depthM = Number.parseFloat(depthAttr ?? '') || defaultDepthM;
      const depth = depthM / svgScale + pathIndex * layerStagger;

      const geom = new ExtrudeGeometry(shapes, {
        depth,
        bevelEnabled: true,
        bevelSegments: 3,
        bevelThickness: 0.7,
        bevelSize: 0.5,
      });

      const mesh = new Mesh(geom, mat);
      mesh.position.z = -depth / 2;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      characterGroup.add(mesh);
    });

    this.normalizeAndCenterSvgGroup(characterGroup, targetHeight);
    group.add(characterGroup);
    this.addPedestal(group, '#334155');
  }

  // --- Style 3: SVG Layered Diorama (Tiered Multi-Depth Relief + Emissive Glow) ---
  private buildSvgLayeredDiorama(group: Group, svgText: string): void {
    const svgData = this.svgLoader.parse(svgText);
    const targetHeight = 1.7;
    const characterGroup = new Group();

    const layerCount = svgData.paths.length;

    // Build backing plate frame from overall paths
    const allShapes: Shape[] = [];
    svgData.paths.forEach((p) => {
      const shapes = SVGLoader.createShapes(p);
      allShapes.push(...shapes);
    });

    if (allShapes.length > 0) {
      const backMat = new MeshStandardMaterial({
        color: '#090d16',
        roughness: 0.85,
        metalness: 0.2,
      });
      const backGeom = new ExtrudeGeometry(allShapes, {
        depth: 0.28,
        bevelEnabled: true,
        bevelSegments: 2,
        bevelThickness: 0.02,
        bevelSize: 0.02,
      });
      const backMesh = new Mesh(backGeom, backMat);
      backMesh.position.z = -0.16;
      backMesh.castShadow = true;
      characterGroup.add(backMesh);
    }

    svgData.paths.forEach((path, pathIndex) => {
      const fillColor = path.userData?.['style']?.['fill'];
      if (!fillColor || fillColor === 'none') return;

      const shapes: Shape[] = SVGLoader.createShapes(path);
      const color = new Color(fillColor);

      // Check for neon/energy channels (e.g. pink, cyan, neon red)
      const isNeon = (color.r > 0.8 && color.b > 0.5) || (color.b > 0.8 && color.g > 0.6);

      // Stagger layer depth: front details protrude forward
      const depthTier = 0.08 + (pathIndex / layerCount) * 0.12;
      const zOffset = (pathIndex / layerCount) * 0.08;

      const mat = new MeshStandardMaterial({
        color,
        roughness: isNeon ? 0.15 : 0.5,
        metalness: isNeon ? 0.1 : 0.35,
        emissive: isNeon ? color : new Color(0x000000),
        emissiveIntensity: isNeon ? 1.6 : 0,
      });

      const geom = new ExtrudeGeometry(shapes, {
        depth: depthTier,
        bevelEnabled: true,
        bevelSegments: 2,
        bevelThickness: 0.015,
        bevelSize: 0.012,
      });

      const mesh = new Mesh(geom, mat);
      mesh.position.z = zOffset;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      characterGroup.add(mesh);
    });

    this.normalizeAndCenterSvgGroup(characterGroup, targetHeight);
    group.add(characterGroup);
    this.addPedestal(group, '#0f172a');
  }

  // --- SVG Transform & Centering Utilities ---
  private normalizeAndCenterSvgGroup(group: Group, targetHeight: number): void {
    // Invert Y axis because SVG coordinate system has Y+ downwards, while Three.js has Y+ upwards
    // Also scale proportionally to target height
    const svgBoxHeight = 120; // Our SVGs are drawn on a 120-unit high viewBox
    const scale = targetHeight / svgBoxHeight;

    group.scale.set(scale, -scale, scale);

    // Center X on 50 (middle of viewBox 0 0 100 120) and align base feet (Y 118) to pedestal surface (y = 0.08)
    group.position.set(-50 * scale, 118 * scale + 0.08, 0);
  }

  private addPedestal(group: Group, color = '#2a2f3a'): void {
    const mat = new MeshStandardMaterial({ color, roughness: 0.8, metalness: 0.2 });
    const pedestal = new Mesh(new CylinderGeometry(0.55, 0.6, 0.08, 32), mat);
    pedestal.position.y = 0.04;
    pedestal.receiveShadow = true;
    group.add(pedestal);
  }
}

