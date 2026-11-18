import { Component, computed, effect, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { filter, map, startWith } from 'rxjs';

import { AuthService } from './core/auth.service';
import { AccountsService } from './core/accounts.service';
import { CurrencyService } from './core/currency.service';
import { PendingService } from './core/pending.service';
import { RemindersService } from './core/reminders.service';
import { ThemeService } from './core/theme.service';
import { NetworkService } from './core/network.service';
import { ToastService } from './ui/toast.service';
import { IconComponent } from './ui/icon.component';
import { ToastComponent } from './ui/toast.component';
import { UpdateBannerComponent } from './ui/update-banner.component';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, RouterLink, RouterLinkActive, UpdateBannerComponent, IconComponent, ToastComponent],
  host: {
    '(document:click)': 'onDocumentClick()',
    '(document:keydown.escape)': 'closeMenu()',
    '(document:keydown)': 'onKeydown($event)',
  },
  templateUrl: './app.component.html',
  styleUrl: './app.component.less',
})
export class AppComponent {
  private readonly auth = inject(AuthService);
  private readonly accounts = inject(AccountsService);
  private readonly currency = inject(CurrencyService);
  private readonly router = inject(Router);
  private readonly pending = inject(PendingService);
  private readonly reminders = inject(RemindersService);
  // Инжектим на старте: сервис применяет сохранённую тему сразу после загрузки.
  private readonly theme = inject(ThemeService);
  private readonly network = inject(NetworkService);
  private readonly toast = inject(ToastService);
  readonly online = this.network.online;

  readonly isReady = this.auth.isReady;
  readonly isAuthenticated = this.auth.isAuthenticated;
  readonly displayName = computed(
    () => this.auth.profile()?.displayName || this.auth.user()?.email || '',
  );
  /** Инициалы для аватара в шапке: «QA Проверка» → «QП». */
  readonly initials = computed(() => {
    const parts = this.displayName().trim().split(/\s+/).filter(Boolean).slice(0, 2);
    return parts.map((part) => part[0]?.toUpperCase() ?? '').join('') || '?';
  });
  readonly total = computed(() => this.currency.format(this.accounts.total()));

  /** Разделы нижнего таб-бара: порядок задаёт позицию «пилюли». */
  private readonly tabRoutes = ['/', '/operations', '/calendar', '/stats', '/planner'];

  /** Индекс активного раздела: -1 — раздел вне таб-бара (настройки). */
  readonly tabIndex = toSignal(
    this.router.events.pipe(
      filter((event): event is NavigationEnd => event instanceof NavigationEnd),
      map((event) => this.tabIndexOf(event.urlAfterRedirects)),
      startWith(this.tabIndexOf(this.router.url)),
    ),
    { initialValue: -1 },
  );

  /** Открыт ли dropdown пользователя (Настройки / Выйти). */
  readonly menuOpen = signal(false);

  constructor() {
    // Выход (или потеря сессии) на защищённой странице — уводим на /auth.
    effect(() => {
      if (this.isReady() && !this.isAuthenticated() && this.router.url !== '/auth') {
        const returnUrl = this.router.url;
        void this.router.navigate(['/auth'], { queryParams: { returnUrl } });
      }
    });

    // Бейдж с числом платежей + напоминание (не чаще раза в день).
    effect(() => {
      const items = this.isAuthenticated() ? this.pending.items() : [];
      this.reminders.setBadge(items.length);
      this.reminders.notifyPending(items);
    });
  }

  toggleMenu(): void {
    this.menuOpen.update((v) => !v);
  }

  closeMenu(): void {
    this.menuOpen.set(false);
  }

  /** Горячие клавиши: N — новая операция, / — поиск, ? — подсказка. */
  onKeydown(event: KeyboardEvent): void {
    if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) {
      return;
    }
    const target = event.target as HTMLElement | null;
    const tag = target?.tagName?.toLowerCase();
    if (tag === 'input' || tag === 'textarea' || tag === 'select' || target?.isContentEditable) {
      return;
    }
    if (!this.isAuthenticated()) {
      return;
    }

    switch (event.key.toLowerCase()) {
      case 'n':
      case 'т':
        event.preventDefault();
        void this.router.navigate(['/operations'], { queryParams: { new: '1' } });
        break;
      case '/':
        event.preventDefault();
        void this.router.navigate(['/operations'], { queryParams: { focus: 'search' } });
        break;
      case '?':
        this.toast.show('N — новая операция · / — поиск по журналу');
        break;
      default:
        break;
    }
  }

  /** URL → индекс раздела таб-бара (-1, если раздел не в навигации). */
  private tabIndexOf(url: string): number {
    const path = url.split('?')[0].split('#')[0];
    return this.tabRoutes.findIndex((route) => (route === '/' ? path === '/' : path.startsWith(route)));
  }

  onDocumentClick(): void {
    // Клики внутри меню перехватываются stopPropagation — сюда доходит только клик снаружи.
    if (this.menuOpen()) {
      this.menuOpen.set(false);
    }
  }

  logout(): void {
    this.menuOpen.set(false);
    void this.auth.logout();
  }
}
