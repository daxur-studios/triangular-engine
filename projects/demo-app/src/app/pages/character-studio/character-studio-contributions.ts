import {
  ALL_CAPSULE_CHARACTER_PRESETS,
  CAPSULE_ACCESSORY_IDS,
  CAPSULE_CAT_BODY_PATTERN_IDS,
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
  type CapsuleCatCharacterDNA,
  type CapsuleCatGaitMode,
  type CapsuleCatPackId,
  type CapsuleCharacterDNA,
  type CapsuleChestPatchId,
  type CapsuleFacialHairId,
  type CapsuleHairStyleId,
  type CapsuleLocomotionMode,
  type ExtendedEmotionName,
} from 'triangular-engine/characters';
import { CapsuleCatActor, CapsuleCharacterActor } from 'triangular-engine/procedural';
import { Group } from 'three';

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

export function createCharacterStudioContributions(): Readonly<Record<CharacterStudioFamilyId, CharacterStudioContribution>> {
  const humanActor = new CapsuleCharacterActor({
    dna: CAPSULE_CHARACTER_PRESETS.find((preset) => preset.id === 'wacky-helmet-waver'),
    autoBlink: true,
  });
  const humanPresets = presets(ALL_CAPSULE_CHARACTER_PRESETS);
  const humanDefault = 'wacky-helmet-waver';
  const humanMotions = choices(['idle', 'walk', 'run', 'float']);

  const human: CharacterStudioContribution = {
    id: 'human',
    name: 'Capsule Human',
    category: 'Humanoid',
    summary: 'A procedural capsule character with expressive face, hair and modular space gear.',
    root: humanActor.root,
    cameraTargetY: 0.98,
    faceTargetY: 1.52,
    defaultPresetId: humanDefault,
    presets: humanPresets,
    motions: humanMotions,
    controlGroups: () => [
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
    ],
    selectPreset: (presetId) => {
      const preset = ALL_CAPSULE_CHARACTER_PRESETS.find((candidate) => candidate.id === presetId);
      if (preset) humanActor.setDna(preset);
    },
    setMotion: (motionId) => humanActor.setLocomotion(motionId as CapsuleLocomotionMode),
    setExpression: (expression) => humanActor.facialController.setExpression(expression, 1, 0.2),
    setControl: (controlId, value) => {
      const dna: Partial<CapsuleCharacterDNA> = {};
      switch (controlId) {
        case 'hairStyleId': dna.hairStyleId = value as CapsuleHairStyleId; break;
        case 'facialHairId': dna.facialHairId = value as CapsuleFacialHairId; break;
        case 'hairColor': dna.hairColor = value; break;
        case 'accessory': dna.accessory = value as CapsuleAccessoryId; break;
        case 'chestPatch': dna.chestPatch = value as CapsuleChestPatchId; break;
        case 'helmet': dna.helmet = value === 'true'; break;
        case 'jetpack': dna.jetpack = value === 'true'; break;
      }
      humanActor.setDna(dna);
    },
    randomize: (seed) => humanActor.setSeed(`character-studio-human-${seed}`),
    update: (deltaSeconds) => humanActor.update(deltaSeconds),
    dispose: () => humanActor.dispose(),
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
    controlGroups: () => [
      {
        id: 'appearance',
        label: 'Appearance',
        controls: [
          control('bodyPatternId', 'Body pattern', catActor.dna.bodyPatternId, choices(CAPSULE_CAT_BODY_PATTERN_IDS)),
          control('furColor', 'Fur color', catActor.dna.furColor, choices(DEFAULT_CAPSULE_CAT_FUR_COLORS)),
          control('furAccentColor', 'Accent color', catActor.dna.furAccentColor, choices(DEFAULT_CAPSULE_CAT_FUR_COLORS)),
        ],
      },
      {
        id: 'gear',
        label: 'Gear',
        controls: [
          control('packId', 'Pack', catActor.dna.packId, choices(CAPSULE_CAT_PACK_IDS)),
          control('helmet', 'Bubble helmet', catActor.dna.helmet, booleanChoices),
          control('harness', 'Harness', catActor.dna.harness, booleanChoices),
          control('booties', 'Booties', catActor.dna.booties, booleanChoices),
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
      const dna: Partial<CapsuleCatCharacterDNA> = {};
      switch (controlId) {
        case 'bodyPatternId': dna.bodyPatternId = value as CapsuleCatBodyPatternId; break;
        case 'furColor': dna.furColor = value; break;
        case 'furAccentColor': dna.furAccentColor = value; break;
        case 'packId': dna.packId = value as CapsuleCatPackId; break;
        case 'helmet': dna.helmet = value === 'true'; break;
        case 'harness': dna.harness = value === 'true'; break;
        case 'booties': dna.booties = value === 'true'; break;
      }
      catActor.setDna(dna);
    },
    randomize: (seed) => catActor.setSeed(`character-studio-cat-${seed}`),
    update: (deltaSeconds) => catActor.update(deltaSeconds),
    dispose: () => catActor.dispose(),
  };

  return { human, cat };
}
