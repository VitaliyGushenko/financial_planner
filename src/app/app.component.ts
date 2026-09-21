import { Component, computed, effect, inject } from '@angular/core';
import { Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';

import { AuthService } from './core/auth.service';
import { AccountsService } from './core/accounts.service';
import { formatMoney } from './core/format';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, RouterLink, RouterLinkActive],
  templateUrl: './app.component.html',
  styleUrl: './app.component.less',
})
export class AppComponent {
  private readonly auth = inject(AuthService);
  private readonly accounts = inject(AccountsService);
  private readonly router = inject(Router);

  readonly isReady = this.auth.isReady;
  readonly isAuthenticated = this.auth.isAuthenticated;
  readonly displayName = computed(
    () => this.auth.profile()?.displayName || this.auth.user()?.email || '',
  );
  readonly total = computed(() => formatMoney(this.accounts.total()));

  constructor() {
    // Выход (или потеря сессии) на защищённой странице — уводим на /auth.
    effect(() => {
      if (this.isReady() && !this.isAuthenticated() && this.router.url !== '/auth') {
        const returnUrl = this.router.url;
        void this.router.navigate(['/auth'], { queryParams: { returnUrl } });
      }
    });
  }

  logout(): void {
    void this.auth.logout();
  }
}
