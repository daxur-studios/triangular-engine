import Dexie from 'dexie';
import type { Table } from 'dexie';

export function generateId() {
  return Math.random().toString(36).substring(2, 9);
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
