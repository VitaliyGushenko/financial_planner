import { Component, inject } from '@angular/core';

import { IconComponent } from './icon.component';
import { ToastService } from './toast.service';

/** Контейнер плашек с действием «Отменить». */
@Component({
  selector: 'app-toast',
  imports: [IconComponent],
  template: `
    <div class="toast-stack" aria-live="polite" aria-atomic="false">
      @for (toast of toasts(); track toast.id) {
        <div class="toast">
          <span class="toast-text">{{ toast.message }}</span>
          @if (toast.action) {
            <button type="button" class="toast-action" (click)="service.runAction(toast.id)">
              {{ toast.action.label }}
            </button>
          }
          <button type="button" class="toast-close" (click)="service.dismiss(toast.id)" aria-label="Закрыть">
            <app-icon name="close" />
          </button>
        </div>
      }
    </div>
  `,
})
export class ToastComponent {
  readonly service = inject(ToastService);
  readonly toasts = this.service.toasts;
}
