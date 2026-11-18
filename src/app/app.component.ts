import { Component, computed, effect, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { filter, map, startWith } from 'rxjs';

import { AuthService } from './core/auth.service';
import { AccountsService } from './core/accounts.service';
import { CurrencyService } from './core/currency.service';
import { IconComponent } from './ui/icon.component';
import { ToastComponent } from './ui/toast.component';
import { UpdateBannerComponent } from './ui/update-banner.component';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, RouterLink, RouterLinkActive, UpdateBannerComponent, IconComponent, ToastComponent],
  host: {
    '(document:click)': 'onDocumentClick()',
    '(document:keydown.escape)': 'closeMenu()',
  },
  templateUrl: './app.component.html',
  styleUrl: './app.component.less',
})
export class AppComponent {
  private readonly auth = inject(AuthService);
  private readonly accounts = inject(AccountsService);
  private readonly currency = inject(CurrencyService);
  private readonly router = inject(Router);

  readonly isReady = this.auth.isReady;
  readonly isAuthenticated = this.auth.isAuthenticated;
  readonly displayName = computed(
    () => this.auth.profile()?.displayName || this.auth.user()?.email || '',
  );
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
  }

  toggleMenu(): void {
    this.menuOpen.update((v) => !v);
  }

  closeMenu(): void {
    this.menuOpen.set(false);
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
