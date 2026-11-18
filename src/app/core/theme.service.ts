import { Injectable, effect, signal } from '@angular/core';

export type ThemeMode = 'system' | 'light' | 'dark';

const STORAGE_KEY = 'financial-planner.theme';

/**
 * Тема оформления: системная (по умолчанию), светлая или тёмная.
 * Выбор запоминается в localStorage и применяется через `data-theme`
 * на `<html>`; CSS-токены переключаются без перезагрузки.
 */
@Injectable({ providedIn: 'root' })
export class ThemeService {
  private readonly media = window.matchMedia('(prefers-color-scheme: dark)');
  private readonly systemDark = signal(this.media.matches);

  readonly mode = signal<ThemeMode>(readTheme());

  constructor() {
    this.media.addEventListener('change', (event) => this.systemDark.set(event.matches));

    effect(() => {
      const mode = this.mode();
      const root = document.documentElement;

      if (mode === 'system') {
        root.removeAttribute('data-theme');
      } else {
        root.setAttribute('data-theme', mode);
      }

      try {
        localStorage.setItem(STORAGE_KEY, mode);
      } catch {
        // Приватный режим — просто не запоминаем выбор.
      }

      const dark = mode === 'dark' || (mode === 'system' && this.systemDark());
      document
        .querySelector('meta[name="theme-color"]')
        ?.setAttribute('content', dark ? '#0c1117' : '#1a7f4b');
    });
  }

  set(mode: ThemeMode): void {
    this.mode.set(mode);
  }
}

function readTheme(): ThemeMode {
  try {
    const value = localStorage.getItem(STORAGE_KEY);
    return value === 'light' || value === 'dark' ? value : 'system';
  } catch {
    return 'system';
  }
}
