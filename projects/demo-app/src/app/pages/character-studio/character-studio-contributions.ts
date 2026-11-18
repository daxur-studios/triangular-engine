import {
  ALL_CAPSULE_CHARACTER_PRESETS,
  CAPSULE_ACCESSORY_IDS,
  CAPSULE_CAT_BODY_PATTERN_IDS,
  CAPSULE_CAT_MOUTH_POSE_IDS,
  CAPSULE_CAT_PACK_IDS,
  CAPSULE_CAT_PRESETS,
  CAPSULE_CHARACTER_PRESETS,
  CAPSULE_CHEST_PATCH_IDS,
  CAPSULE_FACIAL_HAIR_IDS,
  CAPSULE_HAIR_STYLE_IDS,
  DEFAULT_CAPSULE_CAT_FUR_COLORS,
  DEFAULT_CAPSULE_HAIR_COLORS,
  type CapsuleAccessoryId,
  type CapsuleCatBodyPatternId,
  type CapsuleCatGaitMode,
  type CapsuleCatPackId,
  type CapsuleCatMouthPose,
  type CapsuleChestPatchId,
  type CapsuleFacialHairId,
  type CapsuleHairStyleId,
  type CapsuleLocomotionMode,
  type ExtendedEmotionName,
} from 'triangular-engine/characters';
import { CapsuleCatActor, CapsuleCharacterActor } from 'triangular-engine/procedural';
import { Box3, Group, Quaternion, Vector3 } from 'three';
import {
  fitCameraToFocusTarget,
  resolveCharacterStudioFocusTarget,
  type CameraFocusFitOptions,
  type ResolvedFocusFraming,
  type VisualFocusTargetId,
} from './character-studio-focus';
import { buildExperimentalPigtailHead, EXPERIMENTAL_PIGTAIL_HEAD_ID } from './experimental-pigtail-head';

export type CharacterStudioFamilyId = 'human' | 'cat';

export interface CharacterStudioChoice {
  readonly value: string;
  readonly label: string;
}

export interface CharacterStudioPreset extends CharacterStudioChoice {}

export interface CharacterStudioControl {
  readonly id: string;
  readonly label: string;
  readonly value: string;
  readonly options: readonly CharacterStudioChoice[];
}

export interface CharacterStudioControlGroup {
  readonly id: string;
  readonly label: string;
  readonly controls: readonly CharacterStudioControl[];
}

/**
 * App-owned contribution boundary for models displayed by the first Character Studio.
 *
 * This is intentionally local to the demo app while the studio experience is being proven.
 */
export interface CharacterStudioContribution {
  readonly id: CharacterStudioFamilyId;
  readonly name: string;
  readonly category: string;
  readonly summary: string;
  readonly root: Group;
  readonly cameraTargetY: number;
  readonly faceTargetY: number;
  readonly defaultPresetId: string;
  readonly presets: readonly CharacterStudioPreset[];
  readonly motions: readonly CharacterStudioChoice[];
  controlGroups(): readonly CharacterStudioControlGroup[];
  resolveFocusFraming(targetId: VisualFocusTargetId, options?: CameraFocusFitOptions): ResolvedFocusFraming;
  selectPreset(presetId: string): void;
  setMotion(motionId: string): void;
  setExpression(expression: ExtendedEmotionName): void;
  setControl(controlId: string, value: string): void;
  randomize(seed: number): void;
  update(deltaSeconds: number): void;
  dispose(): void;
}

function toLabel(value: string): string {
  return value
    .replaceAll('_', ' ')
    .replaceAll('-', ' ')
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function choices(values: readonly string[]): readonly CharacterStudioChoice[] {
  return values.map((value) => ({ value, label: toLabel(value) }));
}

function presets(values: readonly { readonly id?: string; readonly label?: string }[]): readonly CharacterStudioPreset[] {
  return values.flatMap((value) => value.id && value.label
    ? [{ value: value.id, label: value.label }]
    : []);
}

function control(
  id: string,
  label: string,
  value: string | boolean,
  options: readonly CharacterStudioChoice[],
): CharacterStudioControl {
  return { id, label, value: String(value), options };
}

const booleanChoices = choices(['true', 'false']);
const renderModeChoices: readonly CharacterStudioChoice[] = [
  { value: 'shaded', label: 'Shaded' },
  { value: 'id_colours', label: 'ID colours' },
];

export function createCharacterStudioContributions(): Readonly<Record<CharacterStudioFamilyId, CharacterStudioContribution>> {
  const humanActor = new CapsuleCharacterActor({
    dna: CAPSULE_CHARACTER_PRESETS.find((preset) => preset.id === 'wacky-helmet-waver'),
    autoBlink: true,
  });
  const humanRoot = new Group();
  humanRoot.add(humanActor.root);
  let experimentalHead: ReturnType<typeof buildExperimentalPigtailHead> | undefined;
  const humanPresets = [
    { value: EXPERIMENTAL_PIGTAIL_HEAD_ID, label: 'Orange Pigtails (Experimental Head)' },
    ...presets(ALL_CAPSULE_CHARACTER_PRESETS),
  ];
  const humanDefault = 'wacky-helmet-waver';
  const humanMotions = choices(['idle', 'walk', 'run', 'float']);
  let rightHandAction: 'none' | 'wave' | 'point' | 'hold_gadget' | 'salute' | 'reach' = 'none';
  let leftHandAction: 'none' | 'wave' | 'point' | 'hold_gadget' | 'salute' | 'reach' = 'none';

  const human: CharacterStudioContribution = {
    id: 'human',
    name: 'Capsule Human',
    category: 'Humanoid',
    summary: 'A procedural capsule character with expressive face, hair and modular space gear.',
    root: humanRoot,
    cameraTargetY: 0.98,
    faceTargetY: 1.52,
    defaultPresetId: humanDefault,
    presets: humanPresets,
    get motions() { return experimentalHead?.head.visible ? [] : humanMotions; },
    resolveFocusFraming: (targetId, options) => fitCameraToFocusTarget(
      experimentalHead?.head.visible ? {
        id: targetId,
        label: 'Experimental Pigtail Head',
        boundsKind: 'scene-object',
        worldBounds: new Box3().setFromObject(experimentalHead.head, true),
        forwardNormal: new Vector3(0, 0, 1).applyQuaternion(humanRoot.getWorldQuaternion(new Quaternion())),
        defaultPadding: .12,
        subBounds: {},
        limitations: [],
      } : resolveCharacterStudioFocusTarget(targetId, { humanActor }),
      options,
    ),
    controlGroups: () => experimentalHead?.head.visible ? [] : [
      {
        id: 'appearance',
        label: 'Appearance',
        controls: [
          control('hairStyleId', 'Hair style', humanActor.dna.hairStyleId, choices(CAPSULE_HAIR_STYLE_IDS)),
          control('facialHairId', 'Facial hair', humanActor.dna.facialHairId, choices(CAPSULE_FACIAL_HAIR_IDS)),
          control('hairColor', 'Hair color', humanActor.dna.hairColor, choices(DEFAULT_CAPSULE_HAIR_COLORS)),
        ],
      },
      {
        id: 'gear',
        label: 'Gear',
        controls: [
          control('accessory', 'Accessory', humanActor.dna.accessory, choices(CAPSULE_ACCESSORY_IDS)),
          control('chestPatch', 'Chest patch', humanActor.dna.chestPatch, choices(CAPSULE_CHEST_PATCH_IDS)),
          control('helmet', 'Helmet', humanActor.dna.helmet, booleanChoices),
          control('jetpack', 'Jetpack', humanActor.dna.jetpack, booleanChoices),
        ],
      },
      {
        id: 'pose',
        label: 'Pose details',
        controls: [
          control('rightHandAction', 'Right hand', rightHandAction, choices(['none', 'wave', 'point', 'hold_gadget', 'salute', 'reach'])),
          control('leftHandAction', 'Left hand', leftHandAction, choices(['none', 'wave', 'point', 'hold_gadget', 'salute', 'reach'])),
        ],
      },
      {
        id: 'render',
        label: 'Render',
        controls: [
          // Flat ID colours: one unlit colour per face part, for checking face probes against a render.
          control('renderMode', 'Render mode', humanActor.idColourModeEnabled ? 'id_colours' : 'shaded', renderModeChoices),
        ],
      },
    ],
    selectPreset: (presetId) => {
      if (presetId === EXPERIMENTAL_PIGTAIL_HEAD_ID) {
        if (!experimentalHead) {
          experimentalHead = buildExperimentalPigtailHead(humanActor.facialController);
          humanRoot.add(experimentalHead.head);
        }
        experimentalHead.head.visible = true;
        humanActor.root.visible = false;
        experimentalHead.update(0);
        return;
      }
      const preset = ALL_CAPSULE_CHARACTER_PRESETS.find((candidate) => candidate.id === presetId);
      if (preset || presetId === 'custom') {
        if (experimentalHead) experimentalHead.head.visible = false;
        humanActor.root.visible = true;
        if (preset) humanActor.setDna(preset);
      }
    },
    setMotion: (motionId) => humanActor.setLocomotion(motionId as CapsuleLocomotionMode),
    setExpression: (expression) => humanActor.facialController.setExpression(expression, 1, 0.2),
    setControl: (controlId, value) => {
      switch (controlId) {
        case 'hairStyleId': humanActor.setDna({ hairStyleId: value as CapsuleHairStyleId }); break;
        case 'facialHairId': humanActor.setDna({ facialHairId: value as CapsuleFacialHairId }); break;
        case 'hairColor': humanActor.setDna({ hairColor: value }); break;
        case 'accessory': humanActor.setDna({ accessory: value as CapsuleAccessoryId }); break;
        case 'chestPatch': humanActor.setDna({ chestPatch: value as CapsuleChestPatchId }); break;
        case 'helmet': humanActor.setDna({ helmet: value === 'true' }); break;
        case 'jetpack': humanActor.setDna({ jetpack: value === 'true' }); break;
        case 'rightHandAction':
          rightHandAction = value as typeof rightHandAction;
          humanActor.setHandAction('right', rightHandAction);
          break;
        case 'leftHandAction':
          leftHandAction = value as typeof leftHandAction;
          humanActor.setHandAction('left', leftHandAction);
          break;
        case 'renderMode': humanActor.setIdColourMode(value === 'id_colours'); break;
      }
    },
    randomize: (seed) => humanActor.setSeed(`character-studio-human-${seed}`),
    update: (deltaSeconds) => {
      if (experimentalHead?.head.visible) experimentalHead.update(deltaSeconds);
      else humanActor.update(deltaSeconds);
    },
    dispose: () => {
      experimentalHead?.dispose();
      humanActor.dispose();
    },
  };

  const catActor = new CapsuleCatActor({ dna: CAPSULE_CAT_PRESETS[0], autoBlink: true });
  const catPresets = presets(CAPSULE_CAT_PRESETS);
  const catDefault = CAPSULE_CAT_PRESETS[0].id!;
  const catMotions = choices(['idle', 'goofy_walk', 'bound_run', 'float']);

  const cat: CharacterStudioContribution = {
    id: 'cat',
    name: 'Capsule Space Cat',
    category: 'Companion',
    summary: 'A four-legged capsule explorer with expressive ears, whiskers and space gear.',
    root: catActor.root,
    cameraTargetY: 0.34,
    faceTargetY: 0.49,
    defaultPresetId: catDefault,
    presets: catPresets,
    motions: catMotions,
    resolveFocusFraming: (targetId, options) => fitCameraToFocusTarget(
      resolveCharacterStudioFocusTarget(targetId, { catActor }),
      options,
    ),
    controlGroups: () => [
      {
        id: 'appearance',
        label: 'Appearance',
        controls: [
          control('bodyPatternId', 'Body pattern', catActor.dna.bodyPattern, choices(CAPSULE_CAT_BODY_PATTERN_IDS)),
          control('furColor', 'Fur color', catActor.dna.furColor, choices(DEFAULT_CAPSULE_CAT_FUR_COLORS)),
          control('furAccentColor', 'Accent color', catActor.dna.furAccentColor, choices(DEFAULT_CAPSULE_CAT_FUR_COLORS)),
        ],
      },
      {
        id: 'gear',
        label: 'Gear',
        controls: [
          control('packId', 'Pack', catActor.dna.pack, choices(CAPSULE_CAT_PACK_IDS)),
          control('helmet', 'Bubble helmet', catActor.dna.helmet, booleanChoices),
          control('harness', 'Harness', catActor.dna.harness, booleanChoices),
          control('booties', 'Booties', catActor.dna.suitBooties, booleanChoices),
        ],
      },
      {
        id: 'face',
        label: 'Face details',
        controls: [
          control('restMouthPose', 'Resting mouth', catActor.dna.restMouthPose, choices(CAPSULE_CAT_MOUTH_POSE_IDS)),
          control('tuft', 'Crown tuft', catActor.dna.tuft, booleanChoices),
          control('panicked', 'Panicked eyes', catActor.dna.panicked, booleanChoices),
        ],
      },
    ],
    selectPreset: (presetId) => {
      const preset = CAPSULE_CAT_PRESETS.find((candidate) => candidate.id === presetId);
      if (preset) catActor.setDna(preset);
    },
    setMotion: (motionId) => catActor.setLocomotion(motionId as CapsuleCatGaitMode),
    setExpression: (expression) => catActor.facialController.setExpression(expression, 1, 0.2),
    setControl: (controlId, value) => {
      switch (controlId) {
        case 'bodyPatternId': catActor.setDna({ bodyPattern: value as CapsuleCatBodyPatternId }); break;
        case 'furColor': catActor.setDna({ furColor: value }); break;
        case 'furAccentColor': catActor.setDna({ furAccentColor: value }); break;
        case 'packId': catActor.setDna({ pack: value as CapsuleCatPackId }); break;
        case 'helmet': catActor.setDna({ helmet: value === 'true' }); break;
        case 'harness': catActor.setDna({ harness: value === 'true' }); break;
        case 'booties': catActor.setDna({ suitBooties: value === 'true' }); break;
        case 'restMouthPose': catActor.setDna({ restMouthPose: value as CapsuleCatMouthPose }); break;
        case 'tuft': catActor.setDna({ tuft: value === 'true' }); break;
        case 'panicked': catActor.setDna({ panicked: value === 'true' }); break;
      }
    },
    randomize: (seed) => catActor.setSeed(`character-studio-cat-${seed}`),
    update: (deltaSeconds) => catActor.update(deltaSeconds),
    dispose: () => catActor.dispose(),
  };

  return { human, cat };
}
