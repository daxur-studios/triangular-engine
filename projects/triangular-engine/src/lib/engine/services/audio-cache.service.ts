import { Injectable, signal, WritableSignal } from '@angular/core';

@Injectable({
  providedIn: 'root',
})
export class AudioCacheService {
  readonly #audioCache = new Map<
    string,
    WritableSignal<AudioBuffer | undefined>
  >();

  exists(key: string): boolean {
    return this.#audioCache.has(key);
  }
  getAudioCache(key: string): WritableSignal<AudioBuffer | undefined> {
    if (!this.#audioCache.has(key)) {
      this.#audioCache.set(key, signal<AudioBuffer | undefined>(undefined));
    }
    return this.#audioCache.get(key)!;
  }

  setAudioCache(key: string, value: AudioBuffer | undefined) {
    const signal = this.getAudioCache(key);
    signal.set(value);
  }

  deleteAudioCache(key: string) {
    this.#audioCache.delete(key);
  }

  /** Clear all audio cache */
  clearAllAudioCache() {
    this.#audioCache.clear();
  }
}
