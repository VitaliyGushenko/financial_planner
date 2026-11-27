import { Component, effect, inject, input, output } from '@angular/core';
import { FormsModule } from '@angular/forms';

import { MicStatus, SpeechService } from '../core/voice/speech.service';
import { IconComponent } from './icon.component';
import { ModalComponent } from './modal.component';

/**
 * Окно голосового ввода: микрофон + текст, который можно поправить руками.
 * Само ничего не парсит и не сохраняет — отдаёт текст странице операций,
 * та заполняет форму, а пользователь подтверждает.
 */
@Component({
  selector: 'app-voice-input',
  imports: [FormsModule, ModalComponent, IconComponent],
  template: `
    <app-modal [open]="open()" title="Голосовой ввод" (closed)="close()">
      <p class="muted small voice-hint">
        Скажите одной фразой: «потратил пятьсот рублей на продукты вчера» или
        «получил зарплату сто двадцать тысяч». Сумму можно словами.
      </p>

      @if (supported()) {
        <button type="button" class="btn btn-block voice-mic" [class.listening]="listening()" (click)="toggle()">
          @if (listening()) {
            <app-icon name="stop" />
            {{ phase() === 'finalizing' ? 'Распознаю…' : 'Остановить' }}
          } @else {
            <app-icon name="mic" /> Говорить
          }
        </button>

        @if (listening()) {
          <p class="voice-status">
            <span class="voice-wave" aria-hidden="true"><i></i><i></i><i></i><i></i></span>
            {{ phase() === 'starting' ? 'Запускаю микрофон…' : phase() === 'finalizing' ? 'Обрабатываю речь…' : 'Слушаю — говорите' }}
          </p>
        }
      } @else {
        <p class="form-notice">
          Этот браузер не умеет распознавать речь. Введите текст в поле ниже — разбор фразы работает так же.
        </p>
      }

      @if (error()) {
        <p class="form-error">{{ error() }}</p>
      }

      <!-- Проверка микрофона: показывает, приходит ли звук вообще -->
      <div class="mic-check">
        <button
          type="button"
          class="btn btn-ghost btn-sm"
          [disabled]="micStatus() === 'checking'"
          (click)="checkMic()"
        >
          <app-icon name="mic" />
          {{ micStatus() === 'checking' ? 'Проверяю…' : 'Проверить микрофон' }}
        </button>
        @if (micStatus() !== 'idle' && micStatus() !== 'checking') {
          <span class="mic-verdict" [class.ok]="micStatus() === 'ok'" [class.bad]="micStatus() === 'silent' || micStatus() === 'denied' || micStatus() === 'unsupported'">
            {{ micLabel(micStatus()) }}
          </span>
        }
      </div>

      <div class="field voice-text">
        <label for="voiceText">Текст фразы</label>
        <textarea
          id="voiceText"
          name="voiceText"
          rows="3"
          #voiceText
          [(ngModel)]="text"
          placeholder="Например: такси двести пятьдесят вчера"
        ></textarea>
      </div>

      <p class="muted small voice-note">
        Если кнопка «Говорить» не срабатывает — нажмите
        <strong>микрофон на клавиатуре</strong> прямо в поле выше: текст попадёт сюда,
        а разбор фразы будет тем же. Запись в журнал произойдёт только после кнопки
        «Добавить» в форме.
      </p>

      <div class="form-actions">
        <button type="button" class="btn" [disabled]="!text.trim()" (click)="submit()">Заполнить форму</button>
        <button type="button" class="btn btn-ghost" (click)="close()">Отмена</button>
      </div>
    </app-modal>
  `,
  styles: `
    .voice-status {
      display: flex;
      align-items: center;
      gap: 8px;
      margin: 10px 0 0;
      font-size: 13px;
      font-weight: 600;
      color: var(--primary-dark);
    }

    .voice-wave {
      display: inline-flex;
      align-items: center;
      gap: 2px;
      height: 14px;
    }

    .voice-wave i {
      display: block;
      width: 2px;
      height: 100%;
      border-radius: 2px;
      background: currentColor;
      animation: voice-bar 900ms ease-in-out infinite;
    }

    .voice-wave i:nth-child(2) {
      animation-delay: 120ms;
    }

    .voice-wave i:nth-child(3) {
      animation-delay: 240ms;
    }

    .voice-wave i:nth-child(4) {
      animation-delay: 360ms;
    }

    .mic-check {
      display: flex;
      align-items: center;
      gap: 10px;
      flex-wrap: wrap;
      margin: 12px 0 4px;
    }

    .mic-verdict {
      font-size: 13px;
      font-weight: 600;
      color: var(--muted);
    }

    .mic-verdict.ok {
      color: var(--income);
    }

    .mic-verdict.bad {
      color: var(--expense);
    }

    @keyframes voice-bar {
      0%,
      100% {
        transform: scaleY(0.35);
        opacity: 0.6;
      }
      50% {
        transform: scaleY(1);
        opacity: 1;
      }
    }
  `,
})
export class VoiceInputComponent {
  readonly open = input.required<boolean>();
  readonly closed = output<void>();
  readonly submitted = output<string>();

  private readonly speech = inject(SpeechService);

  readonly supported = this.speech.supported;
  readonly listening = this.speech.listening;
  readonly error = this.speech.error;
  readonly phase = this.speech.phase;
  readonly micStatus = this.speech.micStatus;

  text = '';

  constructor() {
    // Пока идёт запись — показываем распознанное в поле, но не затираем
    // ручные правки, если пользователь уже что-то поправил после остановки.
    effect(() => {
      const transcript = this.speech.transcript();
      if (this.listening() && transcript) {
        this.text = transcript;
      }
    });

    effect(() => {
      if (!this.open()) {
        this.speech.cancel();
        this.text = '';
        this.speech.error.set(null);
        this.speech.micStatus.set('idle');
      }
    });
  }

  async toggle(): Promise<void> {
    if (this.listening()) {
      this.speech.stop();
      this.text = this.speech.transcript() || this.text;
      return;
    }
    const heard = await this.speech.listen();
    if (heard) {
      this.text = heard;
    }
  }

  async checkMic(): Promise<void> {
    await this.speech.probeMic();
  }

  micLabel(status: MicStatus): string {
    switch (status) {
      case 'ok':
        return 'Микрофон слышит звук';
      case 'silent':
        return 'Микрофон не передаёт звук';
      case 'denied':
        return 'Доступ к микрофону запрещён';
      case 'unsupported':
        return 'Браузер не даёт доступ к микрофону';
      case 'checking':
        return 'Проверяю…';
      default:
        return '';
    }
  }

  submit(): void {
    const value = this.text.trim();
    if (!value) {
      return;
    }
    this.speech.cancel();
    this.submitted.emit(value);
  }

  close(): void {
    this.speech.cancel();
    this.closed.emit();
  }
}
