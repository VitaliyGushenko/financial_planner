import { ChangeDetectionStrategy, Component, input } from '@angular/core';

/**
 * Единый набор линейных иконок приложения.
 *
 * Один стиль: сетка 24×24, толщина 1.8, скруглённые концы, без заливки.
 * Цвет наследуется от текста (`currentColor`), поэтому активные пункты
 * подсвечиваются зелёным сами, без отдельных «цветных» иконок.
 * Размер задаётся через `--icon-size` (по умолчанию 20px).
 */
export type IconName =
  | 'home'
  | 'receipt'
  | 'calendar'
  | 'chart'
  | 'bag'
  | 'wallet'
  | 'card'
  | 'mic'
  | 'stop'
  | 'warning'
  | 'clock'
  | 'check'
  | 'close'
  | 'ban'
  | 'search'
  | 'chevron-left'
  | 'chevron-right'
  | 'cart'
  | 'car'
  | 'phone'
  | 'heart'
  | 'shirt'
  | 'smile'
  | 'dots'
  | 'gift'
  | 'coffee'
  | 'book'
  | 'plane'
  | 'dumbbell'
  | 'wrench'
  | 'baby'
  | 'bank'
  | 'briefcase';

@Component({
  selector: 'app-icon',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="1.8"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      @switch (name()) {
        @case ('home') {
          <path d="M4 10.5 12 4l8 6.5"></path>
          <path d="M6 9.5V19a1 1 0 0 0 1 1h3.5v-5.5h3V20H17a1 1 0 0 0 1-1V9.5"></path>
        }
        @case ('receipt') {
          <path d="M6.5 3.5h11a1 1 0 0 1 1 1V21l-2.5-1.5L13.5 21 12 19.5 10.5 21 8 19.5 5.5 21V4.5a1 1 0 0 1 1-1Z"></path>
          <path d="M9 8h6"></path>
          <path d="M9 12h6"></path>
        }
        @case ('calendar') {
          <rect x="3.5" y="5.5" width="17" height="15" rx="2.5"></rect>
          <path d="M3.5 10.5h17"></path>
          <path d="M8 3.5v4"></path>
          <path d="M16 3.5v4"></path>
        }
        @case ('chart') {
          <path d="M4 20v-6"></path>
          <path d="M10 20V7"></path>
          <path d="M16 20v-4.5"></path>
          <path d="M2.5 20h19"></path>
        }
        @case ('bag') {
          <path d="M5.5 8.5h13l-1 10.5a1.5 1.5 0 0 1-1.5 1.4H8a1.5 1.5 0 0 1-1.5-1.4l-1-10.5Z"></path>
          <path d="M9 8.5V7a3 3 0 0 1 6 0v1.5"></path>
        }
        @case ('wallet') {
          <rect x="2.5" y="6.5" width="19" height="11" rx="2.5"></rect>
          <circle cx="12" cy="12" r="2.4"></circle>
          <path d="M6 12h.01"></path>
          <path d="M18 12h.01"></path>
        }
        @case ('card') {
          <rect x="2.5" y="5.5" width="19" height="13" rx="2.5"></rect>
          <path d="M2.5 9.5h19"></path>
          <path d="M6 14.5h4"></path>
        }
        @case ('mic') {
          <path d="M12 3.5a3 3 0 0 0-3 3v5a3 3 0 0 0 6 0v-5a3 3 0 0 0-3-3Z"></path>
          <path d="M5.5 11a6.5 6.5 0 0 0 13 0"></path>
          <path d="M12 17.5V21"></path>
        }
        @case ('stop') {
          <rect x="7" y="7" width="10" height="10" rx="2"></rect>
        }
        @case ('warning') {
          <path d="M12 3.6 21 20H3l9-16.4Z"></path>
          <path d="M12 9.5v4.5"></path>
          <path d="M12 17.2h.01"></path>
        }
        @case ('clock') {
          <circle cx="12" cy="12" r="8.5"></circle>
          <path d="M12 7.5V12l3 2"></path>
        }
        @case ('check') {
          <path d="M5 12.5 10 17.5 19 6.5"></path>
        }
        @case ('close') {
          <path d="M6.5 6.5 17.5 17.5"></path>
          <path d="M17.5 6.5 6.5 17.5"></path>
        }
        @case ('ban') {
          <circle cx="12" cy="12" r="8.5"></circle>
          <path d="M6.5 6.5 17.5 17.5"></path>
        }
        @case ('search') {
          <circle cx="11" cy="11" r="6.5"></circle>
          <path d="m16 16 4.5 4.5"></path>
        }
        @case ('chevron-left') {
          <path d="M14.5 6 8.5 12l6 6"></path>
        }
        @case ('chevron-right') {
          <path d="M9.5 6 15.5 12l-6 6"></path>
        }
        @case ('cart') {
          <circle cx="9.5" cy="20" r="1.3"></circle>
          <circle cx="17.5" cy="20" r="1.3"></circle>
          <path d="M3 4h2.2l2.3 10.2a1.6 1.6 0 0 0 1.6 1.3h7.6a1.6 1.6 0 0 0 1.6-1.3L20 7H6"></path>
        }
        @case ('car') {
          <path d="M4 16.5 5.6 11A2 2 0 0 1 7.5 9.5h9a2 2 0 0 1 1.9 1.5L20 16.5"></path>
          <path d="M4 16.5h16v2.5H4z"></path>
          <circle cx="8" cy="19" r="1.4"></circle>
          <circle cx="16" cy="19" r="1.4"></circle>
        }
        @case ('phone') {
          <rect x="7" y="2.5" width="10" height="19" rx="2.5"></rect>
          <path d="M11 18.5h2"></path>
        }
        @case ('heart') {
          <path d="M12 20s-7-4.4-7-9a3.8 3.8 0 0 1 7-2.2A3.8 3.8 0 0 1 19 11c0 4.6-7 9-7 9Z"></path>
        }
        @case ('shirt') {
          <path d="M9 4 4.5 6.5 6 10l2-1v10h8V9l2 1 1.5-3.5L15 4l-1.5 2h-3L9 4Z"></path>
        }
        @case ('smile') {
          <circle cx="12" cy="12" r="8.5"></circle>
          <path d="M9 14.5c.8 1 1.8 1.5 3 1.5s2.2-.5 3-1.5"></path>
          <path d="M9.5 9.5h.01M14.5 9.5h.01"></path>
        }
        @case ('dots') {
          <circle cx="6" cy="12" r="1.2"></circle>
          <circle cx="12" cy="12" r="1.2"></circle>
          <circle cx="18" cy="12" r="1.2"></circle>
        }
        @case ('gift') {
          <rect x="3.5" y="9" width="17" height="11" rx="1.5"></rect>
          <path d="M3.5 12.5h17M12 9v11"></path>
          <path d="M12 9C10 9 8 8 8 6.2A2.2 2.2 0 0 1 12 5a2.2 2.2 0 0 1 4 1.2C16 8 14 9 12 9Z"></path>
        }
        @case ('coffee') {
          <path d="M4 8h12v6a5 5 0 0 1-5 5H9a5 5 0 0 1-5-5V8Z"></path>
          <path d="M16 9h2.5a2.5 2.5 0 0 1 0 5H16"></path>
          <path d="M7 3v2M11 3v2"></path>
        }
        @case ('book') {
          <path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v16H6.5A2.5 2.5 0 0 0 4 21.5V5.5Z"></path>
          <path d="M4 18.5A2.5 2.5 0 0 1 6.5 16H20"></path>
        }
        @case ('plane') {
          <path d="M3 13l18-7-4 18-4.5-6.5L3 13Z"></path>
        }
        @case ('dumbbell') {
          <path d="M6 8v8M4 9.5v5M18 8v8M20 9.5v5M6 12h12"></path>
        }
        @case ('wrench') {
          <path d="M14.5 4a4.5 4.5 0 0 0-4 6.5L4 17l3 3 6.5-6.5a4.5 4.5 0 0 0 6.5-4l-3 1.5-1-1 1.5-3Z"></path>
        }
        @case ('baby') {
          <circle cx="12" cy="8" r="3.5"></circle>
          <path d="M6 21a6 6 0 0 1 12 0"></path>
        }
        @case ('bank') {
          <path d="M3 9 12 4l9 5"></path>
          <path d="M5 10v8M9.5 10v8M14.5 10v8M19 10v8"></path>
          <path d="M3 20h18"></path>
        }
        @case ('briefcase') {
          <rect x="3" y="7" width="18" height="12" rx="2"></rect>
          <path d="M9 7V5.5A1.5 1.5 0 0 1 10.5 4h3A1.5 1.5 0 0 1 15 5.5V7"></path>
          <path d="M3 12h18"></path>
        }
      }
    </svg>
  `,
  styles: `
    :host {
      display: inline-flex;
      flex: none;
      width: var(--icon-size, 20px);
      height: var(--icon-size, 20px);
      vertical-align: -0.15em;
    }

    svg {
      width: 100%;
      height: 100%;
    }
  `,
})
export class IconComponent {
  readonly name = input.required<IconName>();
}
