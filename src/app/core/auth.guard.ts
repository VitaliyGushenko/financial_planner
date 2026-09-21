import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';

import { AuthService } from './auth.service';

/** Пускает только авторизованных; иначе — на /auth с запоминанием целевого URL. */
export const authGuard: CanActivateFn = async (_route, state) => {
  const authService = inject(AuthService);
  const router = inject(Router);
  await authService.ensureReady();
  if (authService.isAuthenticated()) {
    return true;
  }
  return router.createUrlTree(['/auth'], { queryParams: { returnUrl: state.url } });
};

/** Для страницы входа: авторизованных отправляем на главную. */
export const guestGuard: CanActivateFn = async () => {
  const authService = inject(AuthService);
  const router = inject(Router);
  await authService.ensureReady();
  return authService.isAuthenticated() ? router.createUrlTree(['/']) : true;
};
