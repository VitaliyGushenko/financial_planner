import { Injectable, signal } from '@angular/core';

export interface ToastAction {
  label: string;
  run: () => void | Promise<void>;
}

export interface Toast {
  id: number;
  message: string;
  action?: ToastAction;
  duration: number;
}

/**
 * Плашки-уведомления внизу экрана: «Операция удалена — Отменить».
 * Держим максимум три одновременно, остальные вытесняем.
 */
@Injectable({ providedIn: 'root' })
export class ToastService {
  private seq = 0;
  private readonly timers = new Map<number, ReturnType<typeof setTimeout>>();

  readonly toasts = signal<Toast[]>([]);

  show(message: string, options: { action?: ToastAction; duration?: number } = {}): void {
    const id = ++this.seq;
    const toast: Toast = {
      id,
      message,
      action: options.action,
      duration: options.duration ?? 6000,
    };
    this.toasts.update((list) => [...list.slice(-2), toast]);
    this.timers.set(
      id,
      setTimeout(() => this.dismiss(id), toast.duration),
    );
  }

  dismiss(id: number): void {
    const timer = this.timers.get(id);
    if (timer) {
      clearTimeout(timer);
      this.timers.delete(id);
    }
    this.toasts.update((list) => list.filter((toast) => toast.id !== id));
  }

  runAction(id: number): void {
    const toast = this.toasts().find((item) => item.id === id);
    this.dismiss(id);
    void toast?.action?.run();
  }
}
