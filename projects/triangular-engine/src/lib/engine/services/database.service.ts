import { Injectable } from '@angular/core';
import { EngineDatabase } from '../models';

@Injectable({
  providedIn: 'root',
})
export class DatabaseService {
  readonly database = new EngineDatabase();

  constructor() {}
}
