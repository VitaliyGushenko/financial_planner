import { Injectable, NgZone, inject, signal } from '@angular/core';

/**
 * Обёртка над Web Speech API (SpeechRecognition).
 *
 * Работает в Chrome/Edge/Safari (webkit-префикс) и только по HTTPS:
 * распознавание в Chrome облачное и требует интернета.
 *
 * Особенности мобильных браузеров (главное — не сломать их):
 * - Chrome Android НЕ поддерживает continuous: при continuous = true сессия
 *   обрывается без результатов, поэтому всегда continuous = false.
 * - На Android финальный текст часто приходит только после stop()/audioend,
 *   а onend может вообще не прийти — поэтому есть несколько предохранителей:
 *   авто-финализация после паузы в результатах, реакция на audioend и таймер
 *   завершения после ручного stop().
 * - Колбэки приходят вне зоны Angular, сигналы обновляем через zone.run.
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
  onstart: (() => void) | null;
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
  ['audio-capture', 'Микрофон не найден или занят другим приложением.'],
  ['network', 'Нет связи с сервисом распознавания Google. Проверьте интернет или VPN.'],
  ['language-not-supported', 'Русский язык не поддерживается распознаванием в этом браузере.'],
]);

/** Ждём onend после stop(), прежде чем завершить сессию самим (Android его не шлёт). */
const STOP_GRACE_MS = 1600;
/** Пауза в результатах, после которой просим движок финализировать текст. */
const FINALIZE_DEBOUNCE_MS = 1800;
/** Предохранитель от бесконечной записи. */
const MAX_SESSION_MS = 60_000;
/** Если распознавание не стартовало за это время — показываем ошибку. */
const START_TIMEOUT_MS = 6000;

interface ActiveSession {
  id: number;
  finish: (text: string | null, silent?: boolean) => void;
}

@Injectable({ providedIn: 'root' })
export class SpeechService {
  private readonly zone = inject(NgZone);

  private recognition: RecognitionLike | null = null;
  private sessionId = 0;
  private active: ActiveSession | null = null;
  private stopTimer: ReturnType<typeof setTimeout> | null = null;
  private maxTimer: ReturnType<typeof setTimeout> | null = null;
  private finalizeTimer: ReturnType<typeof setTimeout> | null = null;
  private startTimer: ReturnType<typeof setTimeout> | null = null;
  private startRetryTimer: ReturnType<typeof setTimeout> | null = null;
  private started = false;

  /** Доступно ли распознавание: есть API и страница открыта по HTTPS. */
  readonly supported = signal(recognitionCtor() !== null && window.isSecureContext);
  readonly listening = signal(false);
  /** Промежуточный и финальный текст — обновляется по ходу речи. */
  readonly transcript = signal('');
  readonly error = signal<string | null>(null);
  /** Служебное состояние для подсказок в интерфейсе. */
  readonly phase = signal<'idle' | 'starting' | 'listening' | 'finalizing'>('idle');

  /** Слушать фразу. Возвращает распознанный текст или null, если ничего не услышали. */
  listen(): Promise<string | null> {
    const Ctor = recognitionCtor();
    if (!Ctor || !window.isSecureContext) {
      this.error.set('Распознавание речи недоступно: нужен HTTPS и поддерживаемый браузер.');
      return Promise.resolve(null);
    }

    // Прошлую сессию закрываем, но её поздние колбэки больше не влияют на новую.
    this.cancel();

    this.error.set(null);
    this.transcript.set('');
    this.started = false;

    const id = ++this.sessionId;
    const recognition = new Ctor();
    this.recognition = recognition;
    recognition.lang = 'ru-RU';
    // Chrome Android не поддерживает continuous — сессия с ним обрывается.
    recognition.continuous = false;
    recognition.interimResults = true;
    recognition.maxAlternatives = 1;

    return new Promise<string | null>((resolve) => {
      let settled = false;
      let finalizeRequested = false;

      const finish = (text: string | null, silent = false) => {
        if (settled) {
          return;
        }
        settled = true;
        this.clearTimers();
        if (this.sessionId === id) {
          this.recognition = null;
          this.active = null;
        }
        this.zone.run(() => {
          this.listening.set(false);
          this.phase.set('idle');
          // Без текста и без явной ошибки пользователь не понимает, что случилось.
          if (!text && !silent && !this.error()) {
            this.error.set(
              'Речь не распознана. Попробуйте ещё раз — или нажмите микрофон на клавиатуре в поле ниже.',
            );
          }
        });
        resolve(text);
      };

      /** Просим движок отдать финальный результат (Android отдаёт его только так). */
      const requestFinalize = () => {
        if (finalizeRequested || settled) {
          return;
        }
        finalizeRequested = true;
        this.zone.run(() => this.phase.set('finalizing'));
        this.clearFinalizeTimer();
        try {
          recognition.stop();
        } catch {
          finish(this.bestText());
          return;
        }
        // Если onend так и не придёт — завершаем сами.
        this.stopTimer = setTimeout(() => {
          if (this.active?.id === id) {
            active.finish(this.bestText());
          }
        }, STOP_GRACE_MS);
      };

      const active: ActiveSession = { id, finish };
      this.active = active;
      const scheduleFinalize = () => {
        if (finalizeRequested) {
          return;
        }
        this.clearFinalizeTimer();
        this.finalizeTimer = setTimeout(requestFinalize, FINALIZE_DEBOUNCE_MS);
      };

      recognition.onstart = () => {
        if (this.sessionId !== id) {
          return;
        }
        this.started = true;
        if (this.startTimer) {
          clearTimeout(this.startTimer);
          this.startTimer = null;
        }
        this.zone.run(() => this.phase.set('listening'));
      };

      recognition.onresult = (event) => {
        if (this.sessionId !== id) {
          return;
        }
        // Собираем текст заново на каждое событие — results накапливаются,
        // повторный проход по ним не даёт задвоений.
        let finals = '';
        let interim = '';
        for (let i = 0; i < event.results.length; i++) {
          const result = event.results[i];
          const piece = result[0]?.transcript ?? '';
          if (!piece) {
            continue;
          }
          if (result.isFinal) {
            finals += ` ${piece}`;
          } else {
            interim += ` ${piece}`;
          }
        }
        const combined = `${finals} ${interim}`.trim();
        // Колбэки приходят вне зоны Angular — сообщаем ему о сигналах вручную.
        this.zone.run(() => this.transcript.set(combined));
        // Результаты уже пришли — значит движок точно работает.
        this.started = true;
        if (this.startTimer) {
          clearTimeout(this.startTimer);
          this.startTimer = null;
        }
        // После паузы в речи финализируем: так текст гарантированно появится.
        if (combined) {
          scheduleFinalize();
        }
      };

      recognition.onerror = (event) => {
        if (this.sessionId !== id) {
          return;
        }
        // «aborted» — это наш собственный stop(), ошибку не показываем.
        if (event.error === 'aborted') {
          return;
        }
        // Если что-то уже распознали, не пугаем ошибкой «речь не найдена».
        const heardSomething = this.transcript().trim().length > 0;
        if (event.error === 'no-speech' && heardSomething) {
          return;
        }
        const message = ERROR_MESSAGES.get(event.error) ?? 'Не удалось распознать речь.';
        this.zone.run(() => this.error.set(message));
        // «network»/«not-allowed» — движок уже мёртв, не ждём onend.
        if (event.error === 'network' || event.error === 'not-allowed' || event.error === 'audio-capture') {
          finish(this.bestText());
        }
      };

      recognition.onend = () => {
        if (this.sessionId !== id) {
          return;
        }
        finish(this.bestText());
      };

      this.zone.run(() => {
        this.listening.set(true);
        this.phase.set('starting');
      });

      try {
        recognition.start();
      } catch {
        // На Android движок иногда ещё держит прошлую сессию (он один на вкладку)
        // и бросает InvalidStateError. Один короткий повтор обычно решает проблему.
        this.startRetryTimer = setTimeout(() => {
          if (this.sessionId !== id) {
            return;
          }
          try {
            recognition.start();
          } catch {
            this.zone.run(() =>
              this.error.set(
                'Не удалось запустить микрофон. Закройте окно, подождите пару секунд и попробуйте снова.',
              ),
            );
            finish(null);
          }
        }, 400);
        return;
      }

      // Если движок так и не запустился (бывает на Android), объясняем это.
      this.startTimer = setTimeout(() => {
        if (this.sessionId === id && !this.started && !this.transcript().trim()) {
          this.zone.run(() =>
            this.error.set(
              'Браузер не запустил распознавание. Проверьте разрешение на микрофон и попробуйте ещё раз.',
            ),
          );
          finish(null);
        }
      }, START_TIMEOUT_MS);

      // Предохранитель: не даём сессии висеть вечно.
      this.maxTimer = setTimeout(() => {
        if (this.active?.id === id) {
          requestFinalize();
        }
      }, MAX_SESSION_MS);
    });
  }

  /** Остановить запись досрочно — вернётся уже услышанное. */
  stop(): void {
    const active = this.active;
    if (!active) {
      return;
    }
    const recognition = this.recognition;
    this.zone.run(() => this.phase.set('finalizing'));
    try {
      recognition?.stop();
    } catch {
      active.finish(this.bestText());
      return;
    }
    // Android Chrome часто не присылает onend после stop() — завершаем сами.
    this.stopTimer = setTimeout(() => {
      if (this.active?.id === active.id) {
        active.finish(this.bestText());
      }
    }, STOP_GRACE_MS);
  }

  /** Прервать сессию без результата и без сообщения об ошибке (закрытие окна). */
  cancel(): void {
    const active = this.active;
    const recognition = this.recognition;
    this.clearTimers();
    this.recognition = null;
    this.active = null;
    this.sessionId++;
    if (recognition) {
      try {
        recognition.abort();
      } catch {
        // ignore
      }
    }
    this.zone.run(() => {
      this.listening.set(false);
      this.phase.set('idle');
    });
    // Разрешаем ожидающий promise, но без текста и без ошибки.
    active?.finish(null, true);
  }

  private bestText(): string | null {
    return this.transcript().trim() || null;
  }

  private clearFinalizeTimer(): void {
    if (this.finalizeTimer) {
      clearTimeout(this.finalizeTimer);
      this.finalizeTimer = null;
    }
  }

  private clearTimers(): void {
    this.clearFinalizeTimer();
    if (this.stopTimer) {
      clearTimeout(this.stopTimer);
      this.stopTimer = null;
    }
    if (this.maxTimer) {
      clearTimeout(this.maxTimer);
      this.maxTimer = null;
    }
    if (this.startTimer) {
      clearTimeout(this.startTimer);
      this.startTimer = null;
    }
    if (this.startRetryTimer) {
      clearTimeout(this.startRetryTimer);
      this.startRetryTimer = null;
    }
  }
}
