import { Directive, ElementRef, HostListener, inject } from '@angular/core';

/**
 * 3D-наклон карточки (CSS perspective + rotateX/rotateY) и световой блик (glare),
 * следующий за курсором мыши или касанием пальца.
 * Уважает системную настройку prefers-reduced-motion.
 */
@Directive({
  selector: '[appTilt3d]',
})
export class Tilt3dDirective {
  private readonly el = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  @HostListener('pointermove', ['$event'])
  onPointerMove(event: PointerEvent): void {
    if (this.reducedMotion) {
      return;
    }
    const host = this.el.nativeElement;
    const rect = host.getBoundingClientRect();
    if (!rect.width || !rect.height) {
      return;
    }
    const x = (event.clientX - rect.left) / rect.width;
    const y = (event.clientY - rect.top) / rect.height;

    const rotateY = ((x - 0.5) * 14).toFixed(2);
    const rotateX = ((0.5 - y) * 12).toFixed(2);

    host.style.setProperty('--tilt-rx', `${rotateX}deg`);
    host.style.setProperty('--tilt-ry', `${rotateY}deg`);
    host.style.setProperty('--glare-x', `${(x * 100).toFixed(1)}%`);
    host.style.setProperty('--glare-y', `${(y * 100).toFixed(1)}%`);
    host.style.setProperty('--glare-opacity', '1');
  }

  @HostListener('pointerleave')
  @HostListener('pointercancel')
  onPointerLeave(): void {
    const host = this.el.nativeElement;
    host.style.setProperty('--tilt-rx', '0deg');
    host.style.setProperty('--tilt-ry', '0deg');
    host.style.setProperty('--glare-opacity', '0');
  }
}
