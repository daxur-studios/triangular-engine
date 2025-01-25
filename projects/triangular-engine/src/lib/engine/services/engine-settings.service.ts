import { inject, Injectable } from '@angular/core';
import { FormControl, FormGroup } from '@angular/forms';
import { debounceTime, distinctUntilChanged } from 'rxjs';
import { DatabaseService } from './database.service';

@Injectable({
  providedIn: 'root',
})
export class EngineSettingsService {
  //#region Injected Dependencies
  readonly databaseService = inject(DatabaseService);
  //#endregion

  readonly settingsForm = new FormGroup<IUserSettingsControls>({
    autoSave: new FormControl(false),
    autoSaveInterval: new FormControl(15),

    //#region Debug
    showPlaceholderEngine: new FormControl(false),
    debug: new FormControl(false),
    //#endregion
  });

  get debug() {
    return this.settingsForm.value.debug ?? false;
  }

  constructor() {
    this.loadSettings().then(() => {
      this.#saveSettingsOnChanges();
    });
  }

  #saveSettingsOnChanges() {
    this.settingsForm.valueChanges
      .pipe(
        debounceTime(500),
        distinctUntilChanged((a, b) => JSON.stringify(a) === JSON.stringify(b))
      )
      .subscribe(() => {
        this.saveSettings();
      });
  }

  async saveSettings() {
    const value = this.settingsForm.value;

    await this.databaseService.database.userSettings.put({
      uid: 'DEFAULT',
      updatedAt: new Date(),
      autoSave: value.autoSave ?? false,
      autoSaveInterval: value.autoSaveInterval ?? 5,
      showPlaceholderEngine: value.showPlaceholderEngine ?? false,
      debug: value.debug ?? false,
    });
  }

  async loadSettings() {
    const userSettings = await this.databaseService.database.userSettings.get(
      'DEFAULT'
    );

    this.settingsForm.setValue({
      autoSave: userSettings?.autoSave ?? false,
      autoSaveInterval: userSettings?.autoSaveInterval ?? 5,
      showPlaceholderEngine: userSettings?.showPlaceholderEngine ?? false,
      debug: userSettings?.debug ?? false,
    });
  }

  public setDebugMode(debug: boolean) {
    this.settingsForm.patchValue({ debug });
  }
}

interface IUserSettingsControls {
  autoSave: FormControl<boolean | null>;
  autoSaveInterval: FormControl<number | null>;

  //#region Debug
  showPlaceholderEngine: FormControl<boolean | null>;
  debug: FormControl<boolean | null>;
  //#endregion
}
