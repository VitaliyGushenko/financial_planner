import { Injectable, NgZone, inject, signal } from '@angular/core';

/**
 * Обёртка над Web Speech API (SpeechRecognition).
 *
 * Работает в Chrome/Edge/Safari (webkit-префикс) и только по HTTPS:
 * распознавание в Chrome облачное и требует интернета. В Firebase
 * Hosting это выполняется автоматически; в dev-режиме по LAN-адресу
 * микрофон браузер заблокирует.
 */

interface RecognitionAlternative {
  transcript: string;
}

interface RecognitionResult {
  isFinal: boolean;
  readonly length: number;
  [index: number]: RecognitionAlternative;
}

interface RecognitionResultList {
  readonly length: number;
  [index: number]: RecognitionResult;
}

interface RecognitionEvent {
  resultIndex: number;
  results: RecognitionResultList;
}

interface RecognitionErrorEvent {
  error: string;
}

interface RecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((event: RecognitionEvent) => void) | null;
  onerror: ((event: RecognitionErrorEvent) => void) | null;
  onend: (() => void) | null;
}

type RecognitionCtor = new () => RecognitionLike;

function recognitionCtor(): RecognitionCtor | null {
  if (typeof window === 'undefined') {
    return null;
  }
  const scope = window as unknown as {
    SpeechRecognition?: RecognitionCtor;
    webkitSpeechRecognition?: RecognitionCtor;
  };
  return scope.SpeechRecognition ?? scope.webkitSpeechRecognition ?? null;
}

const ERROR_MESSAGES = new Map<string, string>([
  ['not-allowed', 'Нет доступа к микрофону. Разрешите его в настройках браузера.'],
  ['service-not-allowed', 'Браузер запретил распознавание речи.'],
  ['no-speech', 'Речь не распознана — попробуйте ещё раз.'],
  ['audio-capture', 'Микрофон не найден.'],
  ['network', 'Нет связи с сервисом распознавания. Проверьте интернет.'],
  ['language-not-supported', 'Русский язык не поддерживается распознаванием в этом браузере.'],
  ['aborted', ''],
]);

@Injectable({ providedIn: 'root' })
export class SpeechService {
  private readonly zone = inject(NgZone);
  private recognition: RecognitionLike | null = null;

  /** Доступно ли распознавание: есть API и страница открыта по HTTPS. */
  readonly supported = signal(recognitionCtor() !== null && window.isSecureContext);
  readonly listening = signal(false);
  /** Промежуточный и финальный текст — обновляется по ходу речи. */
  readonly transcript = signal('');
  readonly error = signal<string | null>(null);

  /** Слушать фразу. Возвращает распознанный текст или null, если ничего не услышали. */
  listen(): Promise<string | null> {
    const Ctor = recognitionCtor();
    if (!Ctor || !window.isSecureContext) {
      this.error.set('Распознавание речи недоступно: нужен HTTPS и поддерживаемый браузер.');
      return Promise.resolve(null);
    }

    this.stop();
    this.error.set(null);
    this.transcript.set('');

    const recognition = new Ctor();
    this.recognition = recognition;
    recognition.lang = 'ru-RU';
    recognition.continuous = false;
    recognition.interimResults = true;
    recognition.maxAlternatives = 1;

    return new Promise<string | null>((resolve) => {
      let finalText = '';

      recognition.onresult = (event) => {
        let interim = '';
        for (let i = event.resultIndex; i < event.results.length; i++) {
          const result = event.results[i];
          const piece = result[0]?.transcript ?? '';
          if (result.isFinal) {
            finalText += ` ${piece}`;
          } else {
            interim += ` ${piece}`;
          }
        }
        const combined = `${finalText} ${interim}`.trim();
        // Колбэки приходят вне зоны Angular — сообщаем ему о сигналах вручную.
        this.zone.run(() => this.transcript.set(combined));
      };

      recognition.onerror = (event) => {
        const message = ERROR_MESSAGES.get(event.error) ?? 'Не удалось распознать речь.';
        this.zone.run(() => this.error.set(message || null));
      };

      recognition.onend = () => {
        this.recognition = null;
        this.zone.run(() => this.listening.set(false));
        resolve(finalText.trim() || this.transcript().trim() || null);
      };

      this.zone.run(() => this.listening.set(true));
      try {
        recognition.start();
      } catch {
        this.recognition = null;
        this.zone.run(() => this.listening.set(false));
        resolve(null);
      }
    });
  }

  /** Остановить запись досрочно — вернётся уже услышанное. */
  stop(): void {
    this.recognition?.stop();
  }
}
