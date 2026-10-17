import { Injectable, computed, effect, signal } from '@angular/core';

/** Theme identifiers the demo app can activate. */
export type AppThemeId = 'light' | 'dark';

/** Metadata describing one selectable theme. */
export interface AppThemeDefinition {
  readonly id: AppThemeId;
  readonly label: string;
  readonly colorScheme: 'light' | 'dark';
  readonly htmlClass: string;
}

/** Catalog of themes the app knows how to activate. */
export const APP_THEMES: Record<AppThemeId, AppThemeDefinition> = {
  light: {
    id: 'light',
    label: 'Light',
    colorScheme: 'light',
    htmlClass: 'app-light-theme',
  },
  dark: {
    id: 'dark',
    label: 'Dark',
    colorScheme: 'dark',
    htmlClass: 'app-dark-theme',
  },
};

/** localStorage key that persists the active theme id. */
const THEME_STORAGE_KEY = 'theme';

/** Theme used when no preference has been stored yet. */
const DEFAULT_THEME_ID: AppThemeId = 'dark';

/**
 * Owns the active light/dark theme for the demo app.
 *
 * Value: gives the whole app a single injectable, signal-based source of truth for the
 * current theme; applies the shared DOM contract (`html` class + `data-theme`) so both
 * Material system tokens and app tokens switch together; and persists the choice so it
 * survives reloads.
 */
@Injectable({ providedIn: 'root' })
export class ThemeService {
  private readonly themeSignal = signal<AppThemeId>(this.readStoredTheme());

  /** Active theme id. */
  readonly theme = this.themeSignal.asReadonly();

  /** Definition of the active theme. */
  readonly currentTheme = computed(() => APP_THEMES[this.themeSignal()]);

  /** True while the dark theme is active. */
  readonly isDarkMode = computed(() => this.themeSignal() === 'dark');

  /** True while the light theme is active. */
  readonly isLightMode = computed(() => this.themeSignal() === 'light');

  constructor() {
    this.applyTheme(this.themeSignal());
    effect(() => {
      const active = this.themeSignal();
      localStorage.setItem(THEME_STORAGE_KEY, active);
      this.applyTheme(active);
    });
  }

  /** Switch to the opposite theme. */
  toggle(): void {
    this.setTheme(this.isDarkMode() ? 'light' : 'dark');
  }

  /** Activate a specific theme. */
  setTheme(theme: AppThemeId): void {
    this.themeSignal.set(theme);
  }

  private readStoredTheme(): AppThemeId {
    if (typeof localStorage === 'undefined') {
      return DEFAULT_THEME_ID;
    }
    const stored = localStorage.getItem(THEME_STORAGE_KEY);
    return stored === 'light' || stored === 'dark' ? stored : DEFAULT_THEME_ID;
  }

  private applyTheme(themeId: AppThemeId): void {
    const active = APP_THEMES[themeId];
    for (const definition of Object.values(APP_THEMES)) {
      document.documentElement.classList.remove(definition.htmlClass);
    }
    document.documentElement.classList.add(active.htmlClass);
    document.documentElement.setAttribute('data-theme', active.colorScheme);
  }
}
