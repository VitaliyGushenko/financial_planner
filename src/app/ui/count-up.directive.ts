import { DestroyRef, Directive, ElementRef, effect, inject, input } from '@angular/core';

/**
 * Анимирует число в тексте элемента: 0 → 12 345 ₽ за ~400 мс.
 *
 * Форматирование отдаём снаружи (moneyFn из компонента), чтобы не зашивать
 * валюту и разделители. Функция форматирования вызывается внутри effect,
 * поэтому смена валюты в настройках тоже перерисовывает счётчик.
 * При `prefers-reduced-motion` число показывается сразу.
 */
@Directive({ selector: '[appCountUp]' })
export class CountUpDirective {
  readonly appCountUp = input.required<number>();
  readonly appCountUpFormat = input<(value: number) => string>((value) => String(value));

  private readonly host: ElementRef<HTMLElement> = inject(ElementRef);
  private readonly destroyRef = inject(DestroyRef);
  private frame = 0;
  private current = 0;

  constructor() {
    effect(() => {
      const target = this.appCountUp();
      const format = this.appCountUpFormat();
      // Читаем сигналы внутри format (валюта) — effect подпишется на них.
      const finalText = format(target);
      this.animateTo(target, finalText, format);
    });

    this.destroyRef.onDestroy(() => cancelAnimationFrame(this.frame));
  }

  private animateTo(target: number, finalText: string, format: (value: number) => string): void {
    cancelAnimationFrame(this.frame);

    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reducedMotion || !Number.isFinite(target) || this.current === target) {
      this.current = target;
      this.host.nativeElement.textContent = finalText;
      return;
    }

    const from = this.current;
    this.current = target;
    const duration = 420;
    const startedAt = performance.now();

    const tick = (now: number): void => {
      const progress = Math.min(1, (now - startedAt) / duration);
      const eased = 1 - Math.pow(1 - progress, 3);
      if (progress < 1) {
        this.host.nativeElement.textContent = format(from + (target - from) * eased);
        this.frame = requestAnimationFrame(tick);
      } else {
        // Финальную строку берём готовую — без ошибок округления на последнем кадре.
        this.host.nativeElement.textContent = finalText;
      }
    };

    this.frame = requestAnimationFrame(tick);
  }
}
