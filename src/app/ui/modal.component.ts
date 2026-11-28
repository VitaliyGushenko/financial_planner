import { Component, effect, input, output, signal } from '@angular/core';

import { IconComponent } from './icon.component';

/**
 * Модалка: подложка (клик — закрыть), Escape, кнопка ✕. Контент — через ng-content.
 * На телефоне превращается в bottom-sheet: ручка сверху, свайп вниз закрывает.
 */
@Component({
  selector: 'app-modal',
  imports: [IconComponent],
  host: { '(document:keydown.escape)': 'onEscape()', '(document:keydown)': 'onKeydown($event)' },
  template: `
    @if (open()) {
      <div class="modal-backdrop" (click)="close()">
        <div
          class="modal-dialog"
          [class.dragging]="dragging()"
          [style.transform]="dragY() > 0 ? 'translateY(' + dragY() + 'px)' : null"
          role="dialog"
          aria-modal="true"
          [attr.aria-label]="title()"
          tabindex="-1"
          (click)="$event.stopPropagation()"
        >
          <div
            class="sheet-grip"
            aria-hidden="true"
            (pointerdown)="startDrag($event)"
            (pointermove)="moveDrag($event)"
            (pointerup)="endDrag()"
            (pointercancel)="endDrag()"
          ></div>
          <div class="modal-head">
            <h2>{{ title() }}</h2>
            <button type="button" class="modal-close" (click)="close()" aria-label="Закрыть">
              <app-icon name="close" />
            </button>
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

  /** Насколько шторку уже сдвинули вниз (px). */
  readonly dragY = signal(0);
  readonly dragging = signal(false);
  private dragStartY: number | null = null;
  private previousFocus: HTMLElement | null = null;

  constructor() {
    // Блокируем прокрутку страницы, пока модалка открыта.
    effect(() => {
      const isOpen = this.open();
      document.body.classList.toggle('modal-open', isOpen);
      if (isOpen) {
        this.previousFocus = document.activeElement as HTMLElement | null;
        setTimeout(() => this.dialog()?.focus({ preventScroll: true }));
      } else {
        this.previousFocus?.focus?.();
        this.previousFocus = null;
      }
    });
  }

  private dialog(): HTMLElement | null {
    return document.querySelector<HTMLElement>('.modal-dialog');
  }

  /** Не выпускаем фокус за пределы модалки по Tab. */
  onKeydown(event: KeyboardEvent): void {
    if (event.key !== 'Tab' || !this.open()) {
      return;
    }
    const dialog = this.dialog();
    if (!dialog) {
      return;
    }
    const focusable = dialog.querySelectorAll<HTMLElement>(
      'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
    );
    if (!focusable.length) {
      event.preventDefault();
      dialog.focus();
      return;
    }
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    const active = document.activeElement;
    if (event.shiftKey && (active === first || active === dialog)) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && active === last) {
      event.preventDefault();
      first.focus();
    }
  }

  close(): void {
    this.dragStartY = null;
    this.dragging.set(false);
    this.dragY.set(0);
    this.closed.emit();
  }

  onEscape(): void {
    if (this.open()) {
      this.closed.emit();
    }
  }

  /** Свайп вниз работает только там, где модалка — шторка (≤640px). */
  startDrag(event: PointerEvent): void {
    if (!window.matchMedia('(max-width: 640px)').matches) {
      return;
    }
    this.dragStartY = event.clientY;
    this.dragY.set(0);
    this.dragging.set(true);
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
  }

  moveDrag(event: PointerEvent): void {
    if (this.dragStartY === null) {
      return;
    }
    this.dragY.set(Math.max(0, event.clientY - this.dragStartY));
  }

  endDrag(): void {
    if (this.dragStartY === null) {
      return;
    }
    const distance = this.dragY();
    this.dragStartY = null;
    this.dragging.set(false);
    this.dragY.set(0);
    // Тянули достаточно далеко — закрываем, иначе пружина возвращает на место.
    if (distance > 110) {
      this.close();
    }
  }
}
