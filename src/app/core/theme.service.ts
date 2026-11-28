import { Injectable, computed, effect, signal } from '@angular/core';

export type ThemeMode = 'system' | 'light' | 'dark';
export type PaletteId = 'forest' | 'ocean' | 'violet' | 'sunset' | 'graphite' | 'sand';
export type SkinId = 'default' | 'oled' | 'paper' | 'aurora';

export interface PaletteOption {
  id: PaletteId;
  label: string;
  /** Превью: светлая и тёмная половины. */
  preview: string;
  primary: string;
  primaryDark: string;
  surface: string;
  themeColorLight: string;
  themeColorDark: string;
}

export interface SkinOption {
  id: SkinId;
  label: string;
  description: string;
  preview: string;
  accent: string;
}

export const PALETTES: readonly PaletteOption[] = [
  {
    id: 'forest',
    label: 'Лес',
    preview: 'linear-gradient(135deg, #eef2f5 0 50%, #0c1117 50% 100%)',
    primary: '#1a7f4b',
    primaryDark: '#2f9f66',
    surface: '#ffffff',
    themeColorLight: '#1a7f4b',
    themeColorDark: '#0c1117',
  },
  {
    id: 'ocean',
    label: 'Океан',
    preview: 'linear-gradient(135deg, #eaf3f6 0 50%, #071419 50% 100%)',
    primary: '#0e7490',
    primaryDark: '#38bdf8',
    surface: '#ffffff',
    themeColorLight: '#0e7490',
    themeColorDark: '#071419',
  },
  {
    id: 'violet',
    label: 'Аметист',
    preview: 'linear-gradient(135deg, #f3f0fa 0 50%, #100d1b 50% 100%)',
    primary: '#6d4ac7',
    primaryDark: '#a78bfa',
    surface: '#ffffff',
    themeColorLight: '#6d4ac7',
    themeColorDark: '#100d1b',
  },
  {
    id: 'sunset',
    label: 'Закат',
    preview: 'linear-gradient(135deg, #fbf1ea 0 50%, #17100c 50% 100%)',
    primary: '#c24e24',
    primaryDark: '#fb923c',
    surface: '#ffffff',
    themeColorLight: '#c24e24',
    themeColorDark: '#17100c',
  },
  {
    id: 'graphite',
    label: 'Графит',
    preview: 'linear-gradient(135deg, #f1f4f7 0 50%, #0d1116 50% 100%)',
    primary: '#3e6b9e',
    primaryDark: '#7fa8d9',
    surface: '#ffffff',
    themeColorLight: '#3e6b9e',
    themeColorDark: '#0d1116',
  },
  {
    id: 'sand',
    label: 'Песок',
    preview: 'linear-gradient(135deg, #f8f1e4 0 50%, #15110b 50% 100%)',
    primary: '#8a5f1c',
    primaryDark: '#d6a84e',
    surface: '#fffdf8',
    themeColorLight: '#8a5f1c',
    themeColorDark: '#15110b',
  },
];

export const SKINS: readonly SkinOption[] = [
  {
    id: 'default',
    label: 'Обычное',
    description: 'Палитра в светлой или тёмной версии.',
    preview: 'linear-gradient(135deg, #ffffff 0 50%, #151c24 50% 100%)',
    accent: '#1a7f4b',
  },
  {
    id: 'oled',
    label: 'OLED',
    description: 'Чёрный фон и лаймовый акцент. Всегда тёмная.',
    preview: 'linear-gradient(135deg, #000000 0 50%, #0a0c0e 50% 100%)',
    accent: '#b6ff3b',
  },
  {
    id: 'paper',
    label: 'Бумага',
    description: 'Тёплый светлый, без глянца. Всегда светлая.',
    preview: 'linear-gradient(135deg, #f7f1e4 0 50%, #fffdf8 50% 100%)',
    accent: '#8a5f1c',
  },
  {
    id: 'aurora',
    label: 'Аврора',
    description: 'Переливающийся фон и стеклянные карточки.',
    preview: 'linear-gradient(135deg, #2dd4bf, #8b5cf6, #ec4899)',
    accent: '#2dd4bf',
  },
];

interface ThemeState {
  mode: ThemeMode;
  palette: PaletteId;
  skin: SkinId;
}

const STORAGE_KEY = 'financial-planner.theme.v2';
const LEGACY_KEY = 'financial-planner.theme';

/**
 * Оформление: режим (системный/светлый/тёмный), палитра и скин.
 *
 * На <html> выставляются `data-theme`, `data-palette` и `data-skin`.
 * CSS-токены меняются мгновенно; графики перерисовываются по `revision`.
 */
@Injectable({ providedIn: 'root' })
export class ThemeService {
  private readonly media = window.matchMedia('(prefers-color-scheme: dark)');
  private readonly systemDark = signal(this.media.matches);
  private readonly initial = readState();

  readonly mode = signal<ThemeMode>(this.initial.mode);
  readonly palette = signal<PaletteId>(this.initial.palette);
  readonly skin = signal<SkinId>(this.initial.skin);
  /** Увеличивается при любой смене оформления (для графиков). */
  readonly revision = signal(0);

  readonly palettes = PALETTES;
  readonly skins = SKINS;

  readonly effectiveDark = computed(() => {
    const skin = this.skin();
    if (skin === 'oled') {
      return true;
    }
    if (skin === 'paper') {
      return false;
    }
    return this.mode() === 'dark' || (this.mode() === 'system' && this.systemDark());
  });

  /** Что подсвечивать в переключателе режима с учётом фиксированных скинов. */
  readonly activeMode = computed<ThemeMode>(() => {
    const skin = this.skin();
    if (skin === 'oled') {
      return 'dark';
    }
    if (skin === 'paper') {
      return 'light';
    }
    return this.mode();
  });

  constructor() {
    this.media.addEventListener('change', (event) => this.systemDark.set(event.matches));

    effect(() => {
      const dark = this.effectiveDark();
      const palette = this.palette();
      const skin = this.skin();
      const mode = this.mode();
      const root = document.documentElement;

      root.setAttribute('data-theme', dark ? 'dark' : 'light');
      root.setAttribute('data-palette', palette);
      root.setAttribute('data-skin', skin);

      writeState({ mode, palette, skin });

      const meta = document.querySelector('meta[name="theme-color"]');
      if (meta) {
        meta.setAttribute('content', themeColor(palette, skin, dark));
      }

      // Chart.js читает CSS-переменные при отрисовке — сообщаем страницам,
      // что оформление изменилось.
      this.revision.update((value) => value + 1);
    });
  }

  set(mode: ThemeMode): void {
    // Ручной выбор режима выводит из фиксированных скинов.
    if (this.skin() === 'oled' || this.skin() === 'paper') {
      this.skin.set('default');
    }
    this.mode.set(mode);
  }

  setPalette(palette: PaletteId): void {
    if (this.skin() === 'oled' || this.skin() === 'paper') {
      this.skin.set('default');
    }
    this.palette.set(palette);
  }

  setSkin(skin: SkinId): void {
    this.skin.set(skin);
  }
}

function themeColor(palette: PaletteId, skin: SkinId, dark: boolean): string {
  if (skin === 'oled') {
    return '#000000';
  }
  if (skin === 'paper') {
    return '#8a5f1c';
  }
  const option = PALETTES.find((item) => item.id === palette) ?? PALETTES[0];
  return dark ? option.themeColorDark : option.themeColorLight;
}

function readState(): ThemeState {
  const fallback: ThemeState = { mode: 'system', palette: 'forest', skin: 'default' };
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<ThemeState>;
      return {
        mode: parsed.mode === 'light' || parsed.mode === 'dark' ? parsed.mode : 'system',
        palette: PALETTES.some((item) => item.id === parsed.palette)
          ? (parsed.palette as PaletteId)
          : 'forest',
        skin: SKINS.some((item) => item.id === parsed.skin)
          ? (parsed.skin as SkinId)
          : 'default',
      };
    }
    const legacy = localStorage.getItem(LEGACY_KEY);
    if (legacy === 'light' || legacy === 'dark') {
      return { ...fallback, mode: legacy };
    }
  } catch {
    // Приватный режим — значения по умолчанию.
  }
  return fallback;
}

function writeState(state: ThemeState): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Не запоминаем выбор, если хранилище недоступно.
  }
}
