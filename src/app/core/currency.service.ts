import { Injectable, effect, inject, signal } from '@angular/core';

import { AuthService } from './auth.service';
import { formatMoney } from './format';

export interface CurrencyOption {
  code: string;
  name: string;
}

/** Валюты, доступные для выбора в настройках. */
export const CURRENCY_OPTIONS: CurrencyOption[] = [
  { code: 'RUB', name: 'Рубль (₽)' },
  { code: 'USD', name: 'Доллар ($)' },
  { code: 'EUR', name: 'Евро (€)' },
  { code: 'BYN', name: 'Белорусский рубль (Br)' },
  { code: 'KZT', name: 'Тенге (₸)' },
  { code: 'UAH', name: 'Гривна (₴)' },
  { code: 'GBP', name: 'Фунт стерлингов (£)' },
  { code: 'CNY', name: 'Юань (¥)' },
  { code: 'TRY', name: 'Турецкая лира (₺)' },
];

/** Валюта интерфейса: хранится в профиле (settings.currency), применяется по всему приложению. */
@Injectable({ providedIn: 'root' })
export class CurrencyService {
  private readonly auth = inject(AuthService);

  readonly options = CURRENCY_OPTIONS;
  readonly currency = signal('RUB');

  constructor() {
    effect(() => {
      const code = this.auth.profile()?.settings?.currency;
      if (code) {
        this.currency.set(code);
      }
    });
  }

  /** Деньги в текущей валюте: 12345 → «12 345 ₽». */
  format(amount: number | null | undefined): string {
    return formatMoney(amount, this.currency());
  }

  /** Символ текущей валюты для подписей: ₽, $… */
  symbol(): string {
    const code = this.currency();
    try {
      const part = new Intl.NumberFormat('ru-RU', { style: 'currency', currency: code })
        .formatToParts(0)
        .find((p) => p.type === 'currency');
      return part?.value ?? code;
    } catch {
      return code;
    }
  }
}
