import { Component, computed, effect, inject, signal } from '@angular/core';
import { Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';

import { AuthService } from './core/auth.service';
import { AccountsService } from './core/accounts.service';
import { CurrencyService } from './core/currency.service';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, RouterLink, RouterLinkActive],
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
