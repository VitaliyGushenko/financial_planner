import { Component, inject, signal } from '@angular/core';
import { SwUpdate } from '@angular/service-worker';

/**
 * Плашка «доступна новая версия». Без неё установленное PWA может
 * месяцами работать на закэшированной сборке: service worker скачает
 * новую версию, но активирует её только после перезагрузки.
 * В dev-режиме service worker выключен — компонент ничего не рисует.
 */
@Component({
  selector: 'app-update-banner',
  template: `
    @if (ready()) {
      <div class="update-banner" role="status">
        <span>Доступна новая версия</span>
        <button type="button" class="btn btn-sm" (click)="reload()">Обновить</button>
        <button type="button" class="update-banner-later" (click)="dismiss()">Позже</button>
      </div>
    }
  `,
})
export class UpdateBannerComponent {
  private readonly sw = inject(SwUpdate, { optional: true });

  readonly ready = signal(false);

  constructor() {
    const sw = this.sw;
    if (!sw?.isEnabled) {
      return;
    }
    sw.versionUpdates.subscribe((event) => {
      if (event.type === 'VERSION_READY') {
        this.ready.set(true);
      }
    });
    // Проверить сразу при запуске, не дожидаясь периодической проверки.
    void sw.checkForUpdate().catch(() => undefined);
  }

  async reload(): Promise<void> {
    try {
      await this.sw?.activateUpdate();
    } catch {
      // Не удалось активировать — обычная перезагрузка всё равно подхватит новую версию.
    }
    location.reload();
  }

  dismiss(): void {
    this.ready.set(false);
  }
}
