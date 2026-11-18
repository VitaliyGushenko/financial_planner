import { Injectable, signal } from '@angular/core';

import { DayKey, formatDayKeyShort } from './day-key';

export type NotificationPermissionState = 'default' | 'granted' | 'denied' | 'unsupported';

const LAST_NOTIFIED_KEY = 'financial-planner.pending-notified';

interface PendingLike {
  title: string;
  amount: number;
  date: DayKey;
}

/**
 * Напоминания о платежах, ожидающих подтверждения.
 *
 * MVP без сервера: бейдж на иконке приложения (Chromium) и локальное
 * уведомление, которое показывается не чаще раза в день — при открытии
 * приложения. Системный push при закрытом приложении потребовал бы
 * Cloud Functions и отдельной инфраструктуры.
 */
@Injectable({ providedIn: 'root' })
export class RemindersService {
  private readonly supported = typeof window !== 'undefined' && 'Notification' in window;

  readonly permission = signal<NotificationPermissionState>(
    this.supported ? (Notification.permission as NotificationPermissionState) : 'unsupported',
  );

  async requestPermission(): Promise<void> {
    if (!this.supported) {
      return;
    }
    const result = await Notification.requestPermission();
    this.permission.set(result as NotificationPermissionState);
  }

  /** Число платежей на иконке приложения. */
  setBadge(count: number): void {
    const nav = navigator as Navigator & {
      setAppBadge?: (value?: number) => Promise<void>;
      clearAppBadge?: () => Promise<void>;
    };
    if (count > 0) {
      void nav.setAppBadge?.(count)?.catch(() => undefined);
    } else {
      void nav.clearAppBadge?.()?.catch(() => undefined);
    }
  }

  /** Локальное уведомление о платежах, ждущих подтверждения (раз в день). */
  notifyPending(items: readonly PendingLike[]): void {
    if (!this.supported || Notification.permission !== 'granted' || items.length === 0) {
      return;
    }

    const today = new Date().toISOString().slice(0, 10);
    try {
      if (localStorage.getItem(LAST_NOTIFIED_KEY) === today) {
        return;
      }
    } catch {
      // Приватный режим — не запоминаем, но и не падаем.
    }

    const first = items[0];
    const body =
      items.length === 1
        ? `${first.title} — ${formatDayKeyShort(first.date)}`
        : `${first.title} и ещё ${items.length - 1} — откройте «Ожидают подтверждения»`;

    try {
      new Notification('Платежи ждут подтверждения', {
        body,
        icon: 'assets/icons/icon-192.png',
        tag: 'pending-payments',
      });
      localStorage.setItem(LAST_NOTIFIED_KEY, today);
    } catch {
      // Некоторые браузеры запрещают конструктор Notification — молча пропускаем.
    }
  }
}
