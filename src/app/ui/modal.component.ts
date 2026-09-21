import { Component, effect, input, output } from '@angular/core';

/** Простая модалка: подложка (клик — закрыть), Escape, кнопка ✕. Контент — через ng-content. */
@Component({
  selector: 'app-modal',
  host: { '(document:keydown.escape)': 'onEscape()' },
  template: `
    @if (open()) {
      <div class="modal-backdrop" (click)="close()">
        <div class="modal-dialog" role="dialog" aria-modal="true" [attr.aria-label]="title()" (click)="$event.stopPropagation()">
          <div class="modal-head">
            <h2>{{ title() }}</h2>
            <button type="button" class="modal-close" (click)="close()" aria-label="Закрыть">✕</button>
          </div>
          <div class="modal-body">
            <ng-content />
          </div>
        </div>
      </div>
    }
  `,
})
export class ModalComponent {
  readonly open = input.required<boolean>();
  readonly title = input<string>('');
  readonly closed = output<void>();

  constructor() {
    // Блокируем прокрутку страницы, пока модалка открыта.
    effect(() => {
      document.body.classList.toggle('modal-open', this.open());
    });
  }

  close(): void {
    this.closed.emit();
  }

  onEscape(): void {
    if (this.open()) {
      this.closed.emit();
    }
  }
}
