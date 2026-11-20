export const CAPSULE_SPACESUIT_PRESETS = [
  { id: 'orange-pigtails', label: 'Orange Pigtails' },
  { id: 'shaggy', label: 'Shaggy' },
] as const;

export type CapsuleSpacesuitPreset = (typeof CAPSULE_SPACESUIT_PRESETS)[number]['id'];
