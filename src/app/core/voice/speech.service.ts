import { Injectable, NgZone, inject, signal } from '@angular/core';

/**
 * Обёртка над Web Speech API (SpeechRecognition).
 *
 * Работает в Chrome/Edge/Safari (webkit-префикс) и только по HTTPS:
 * распознавание в Chrome облачное и требует интернета.
 *
 * Особенности мобильных браузеров:
 * - Chrome Android НЕ поддерживает continuous и processLocally: сессия с
 *   continuous = true обрывается, офлайн-распознавания на Android нет.
 * - Иногда движок стартует и сразу завершается без результата и без ошибки
 *   (сервис Google недоступен из мобильной сети). Поэтому есть один
 *   автоматический повтор с другим тегом языка, а затем — понятная подсказка.
 * - Финальный текст на Android часто приходит только после stop()/audioend,
 *   а onend может не прийти — поэтому есть таймеры-предохранители.
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
  ['network', 'Нет связи с сервисом распознавания Google. Проверьте интернет или включите VPN.'],
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
/** Сессия короче этого времени без результата считается «движок не ответил». */
const QUICK_FAILURE_MS = 8000;

export type MicStatus = 'idle' | 'checking' | 'ok' | 'silent' | 'denied' | 'unsupported';

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
  private quickFailure = false;
  private cancelled = false;

  /** Доступно ли распознавание: есть API и страница открыта по HTTPS. */
  readonly supported = signal(recognitionCtor() !== null && window.isSecureContext);
  readonly listening = signal(false);
  /** Промежуточный и финальный текст — обновляется по ходу речи. */
  readonly transcript = signal('');
  readonly error = signal<string | null>(null);
  /** Служебное состояние для подсказок в интерфейсе. */
  readonly phase = signal<'idle' | 'starting' | 'listening' | 'finalizing'>('idle');
  /** Результат проверки микрофона (отдельно от распознавания речи). */
  readonly micStatus = signal<MicStatus>('idle');

  /** Слушать фразу. Возвращает распознанный текст или null, если ничего не услышали. */
  async listen(): Promise<string | null> {
    const Ctor = recognitionCtor();
    if (!Ctor || !window.isSecureContext) {
      this.error.set('Распознавание речи недоступно: нужен HTTPS и поддерживаемый браузер.');
      return null;
    }

    this.error.set(null);
    this.micStatus.set('idle');
    this.quickFailure = false;
    this.cancelled = false;

    // Разные сборки Chrome на Android по-разному переживают настройки:
    // пробуем несколько конфигураций, пока одна не отдаст текст.
    const attempts: { lang: string | null; interim: boolean }[] = [
      { lang: 'ru-RU', interim: true },
      { lang: 'ru-RU', interim: false },
      { lang: null, interim: false },
    ];

    for (let index = 0; index < attempts.length; index++) {
      const attempt = attempts[index];
      const isLast = index === attempts.length - 1;
      const text = await this.runAttempt(attempt.lang, attempt.interim, isLast);
      if (text) {
        return text;
      }
      // Окно закрыли — не показываем ошибок и не продолжаем.
      if (this.cancelled) {
        return null;
      }
      // Явная ошибка (нет доступа, нет сети) — другие конфигурации не помогут.
      if (this.error()) {
        return null;
      }
      // Движок отработал не мгновенно — возможно, просто не было речи: не долбим.
      if (!this.quickFailure) {
        break;
      }
    }

    if (!this.cancelled && !this.error()) {
      this.error.set(this.failureMessage());
    }
    return null;
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
    this.cancelled = true;
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

  /**
   * Проверка микрофона отдельно от распознавания: показывает, приходит ли звук.
   * Помогает понять, где проблема — в доступе/железе или в сервисе Google.
   */
  async probeMic(): Promise<MicStatus> {
    this.micStatus.set('checking');
    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      this.micStatus.set('unsupported');
      return 'unsupported';
    }
    let stream: MediaStream | null = null;
    let context: AudioContext | null = null;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      context = new AudioContext();
      const source = context.createMediaStreamSource(stream);
      const analyser = context.createAnalyser();
      analyser.fftSize = 1024;
      source.connect(analyser);
      const buffer = new Uint8Array(analyser.fftSize);
      let peak = 0;
      const until = Date.now() + 1600;
      while (Date.now() < until) {
        analyser.getByteTimeDomainData(buffer);
        for (let i = 0; i < buffer.length; i++) {
          const deviation = Math.abs(buffer[i] - 128);
          if (deviation > peak) {
            peak = deviation;
          }
        }
        await new Promise((resolve) => setTimeout(resolve, 60));
      }
      const status: MicStatus = peak > 4 ? 'ok' : 'silent';
      this.micStatus.set(status);
      return status;
    } catch {
      this.micStatus.set('denied');
      return 'denied';
    } finally {
      stream?.getTracks().forEach((track) => track.stop());
      void context?.close();
    }
  }

  private failureMessage(): string {
    const mic = this.micStatus();
    if (mic === 'silent') {
      return 'Микрофон не передаёт звук. Проверьте, что он не занят другим приложением и не выключен.';
    }
    if (mic === 'denied') {
      return 'Нет доступа к микрофону. Разрешите его для сайта в настройках Chrome.';
    }
    if (mic === 'ok') {
      return 'Микрофон работает, но сервис распознавания Google не ответил. Используйте микрофон на клавиатуре в поле ниже или включите VPN.';
    }
    return 'Браузер не передал распознанный текст. Нажмите микрофон на клавиатуре в поле ниже — разбор фразы будет тем же.';
  }

  /** Одна попытка распознавания. isLast — показывать ли общую подсказку при пустом итоге. */
  private runAttempt(lang: string | null, interim: boolean, isLast: boolean): Promise<string | null> {
    this.cancel();
    this.cancelled = false;
    this.transcript.set('');

    const Ctor = recognitionCtor();
    if (!Ctor) {
      return Promise.resolve(null);
    }

    const id = ++this.sessionId;
    const startedAt = Date.now();
    this.started = false;
    const recognition = new Ctor();
    this.recognition = recognition;
    if (lang) {
      recognition.lang = lang;
    }
    // Chrome Android не поддерживает continuous — сессия с ним обрывается.
    recognition.continuous = false;
    recognition.interimResults = interim;
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
        const quick = !text && Date.now() - startedAt < QUICK_FAILURE_MS;
        if (this.sessionId === id) {
          this.quickFailure = quick;
        }
        this.zone.run(() => {
          this.listening.set(false);
          this.phase.set('idle');
          if (!text && !silent && !this.error() && isLast) {
            this.error.set(this.failureMessage());
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
        this.zone.run(() => this.transcript.set(combined));
        // Результаты уже пришли — значит движок точно работает.
        this.started = true;
        if (this.startTimer) {
          clearTimeout(this.startTimer);
          this.startTimer = null;
        }
        if (combined) {
          scheduleFinalize();
        }
      };

      recognition.onerror = (event) => {
        if (this.sessionId !== id) {
          return;
        }
        if (event.error === 'aborted') {
          return;
        }
        const heardSomething = this.transcript().trim().length > 0;
        if (event.error === 'no-speech' && heardSomething) {
          return;
        }
        const message = ERROR_MESSAGES.get(event.error) ?? 'Не удалось распознать речь.';
        this.zone.run(() => this.error.set(message));
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
            if (isLast) {
              this.zone.run(() =>
                this.error.set(
                  'Не удалось запустить микрофон. Закройте окно, подождите пару секунд и попробуйте снова.',
                ),
              );
            }
            finish(null);
          }
        }, 400);
        return;
      }

      // Если движок так и не запустился (бывает на Android), объясняем это.
      this.startTimer = setTimeout(() => {
        if (this.sessionId === id && !this.started && !this.transcript().trim()) {
          if (isLast) {
            this.zone.run(() =>
              this.error.set(
                'Браузер не запустил распознавание. Проверьте разрешение на микрофон и попробуйте ещё раз.',
              ),
            );
          }
          finish(null);
        }
      }, START_TIMEOUT_MS);

      this.maxTimer = setTimeout(() => {
        if (this.active?.id === id) {
          requestFinalize();
        }
      }, MAX_SESSION_MS);
    });
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
