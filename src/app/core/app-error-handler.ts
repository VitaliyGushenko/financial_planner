import { ErrorHandler, Injectable, inject } from '@angular/core';

import { ToastService } from '../ui/toast.service';

const LOG_KEY = 'financial-planner.errors';

/**
 * Глобальный обработчик ошибок: не даём приложению «молча умереть»,
 * показываем плашку и сохраняем последние 20 ошибок в localStorage
 * (внешний сервис мониторинга не требуется).
 */
@Injectable()
export class AppErrorHandler implements ErrorHandler {
  private readonly toast = inject(ToastService);

  handleError(error: unknown): void {
    console.error(error);
    const message = error instanceof Error ? error.message : String(error);
    this.log(message);
    this.toast.show('Что-то пошло не так. Попробуйте ещё раз.');
  }

  private log(message: string): void {
    try {
      const raw = localStorage.getItem(LOG_KEY);
      const list = raw ? (JSON.parse(raw) as Array<{ at: string; message: string }>) : [];
      list.push({ at: new Date().toISOString(), message: message.slice(0, 500) });
      localStorage.setItem(LOG_KEY, JSON.stringify(list.slice(-20)));
    } catch {
      // Приватный режим — просто не логируем.
    }
  }
}
