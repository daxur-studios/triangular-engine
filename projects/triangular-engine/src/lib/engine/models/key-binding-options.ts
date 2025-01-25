// [keyBindings]="{
//     'Open Menu': {
//       keys: ['Escape', 'm','p'],
//       keydown: toggleMenu($event)
//     }
//   }"

export interface IKeyBindingOptions {
  keys: string[];
  keydown(event: KeyboardEvent): void;
}
