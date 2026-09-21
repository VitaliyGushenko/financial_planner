import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';

import { AuthService } from '../../core/auth.service';
import { firebaseErrorMessage } from '../../core/firebase-error-map';

type AuthMode = 'login' | 'register' | 'reset';

@Component({
  selector: 'app-auth',
  imports: [FormsModule],
  templateUrl: './auth.component.html',
  styleUrl: './auth.component.less',
})
export class AuthComponent {
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);

  readonly mode = signal<AuthMode>('login');
  email = '';
  password = '';
  displayName = '';

  readonly busy = signal(false);
  readonly error = signal('');
  readonly notice = signal('');

  readonly title = computed(
    () => ({ login: 'Вход', register: 'Регистрация', reset: 'Восстановление пароля' })[this.mode()],
  );

  switchMode(mode: AuthMode): void {
    this.mode.set(mode);
    this.error.set('');
    this.notice.set('');
  }

  async submit(): Promise<void> {
    if (this.busy()) {
      return;
    }
    this.error.set('');
    this.notice.set('');
    this.busy.set(true);
    try {
      if (this.mode() === 'login') {
        await this.auth.login(this.email, this.password);
        await this.navigateReturn();
      } else if (this.mode() === 'register') {
        await this.auth.register(this.email, this.password, this.displayName);
        await this.navigateReturn();
      } else {
        await this.auth.resetPassword(this.email);
        this.notice.set('Письмо со ссылкой для восстановления отправлено. Проверьте почту.');
      }
    } catch (err) {
      this.error.set(firebaseErrorMessage(err));
    } finally {
      this.busy.set(false);
    }
  }

  private async navigateReturn(): Promise<void> {
    const returnUrl = this.route.snapshot.queryParamMap.get('returnUrl') ?? '/';
    await this.router.navigateByUrl(returnUrl);
  }
}
