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
  | 'chevron-left'
  | 'chevron-right';

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
        @case ('chevron-left') {
          <path d="M14.5 6 8.5 12l6 6"></path>
        }
        @case ('chevron-right') {
          <path d="M9.5 6 15.5 12l-6 6"></path>
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
