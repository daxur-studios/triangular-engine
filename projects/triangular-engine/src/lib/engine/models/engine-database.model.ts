import Dexie from 'dexie';
import type { Table } from 'dexie';
import { MathUtils } from 'three';

export function generateId() {
  return MathUtils.generateUUID();
}

const databaseVersion = 9;

/** based on Indexed DB using Dexie.js */
export class EngineDatabase extends Dexie implements IStores {
  meta!: Table<Meta, string>;

  userSettings!: Table<IUserSettings, string>;

  constructor() {
    super('DaxurEngine');

    const stores: {
      [key in keyof IStores]: string;
    } = {
      meta: '++type',
      userSettings: '++uid',
    };

    this.version(databaseVersion).stores(stores);
  }
}

interface IStores {
  meta: Table<Meta, string>;
  userSettings: Table<IUserSettings, string>;
}

export interface IUserSettings {
  uid: string;

  updatedAt: Date;

  autoSave: boolean;
  autoSaveInterval: number;

  showPlaceholderEngine: boolean;
  debug: boolean;
}

//#region Meta
export type Meta = {
  type: 'user';
} & UserMeta;

interface UserMeta {
  type: 'user';
  currentUserId: string;
}

//#endregion
