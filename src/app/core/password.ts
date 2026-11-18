/**
 * Валидация формы смены пароля — до обращения к Firebase.
 * Чистая функция, поэтому покрыта тестами.
 */

export type PasswordChangeField = 'current' | 'next' | 'repeat';

export interface PasswordChangeInput {
  current: string;
  next: string;
  repeat: string;
}

export type PasswordChangeValidation =
  | { ok: true }
  | { ok: false; field: PasswordChangeField; message: string };

export const MIN_PASSWORD_LENGTH = 6;

export function validatePasswordChange(input: PasswordChangeInput): PasswordChangeValidation {
  if (!input.current) {
    return { ok: false, field: 'current', message: 'Введите текущий пароль.' };
  }
  if (!input.next) {
    return { ok: false, field: 'next', message: 'Введите новый пароль.' };
  }
  if (input.next.length < MIN_PASSWORD_LENGTH) {
    return {
      ok: false,
      field: 'next',
      message: `Новый пароль слишком короткий — минимум ${MIN_PASSWORD_LENGTH} символов.`,
    };
  }
  if (input.next === input.current) {
    return { ok: false, field: 'next', message: 'Новый пароль совпадает с текущим.' };
  }
  if (input.next !== input.repeat) {
    return { ok: false, field: 'repeat', message: 'Пароли не совпадают.' };
  }
  return { ok: true };
}
