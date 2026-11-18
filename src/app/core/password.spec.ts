import { validatePasswordChange } from './password';

describe('validatePasswordChange', () => {
  it('пропускает корректную замену', () => {
    expect(validatePasswordChange({ current: 'oldpass', next: 'newpass1', repeat: 'newpass1' })).toEqual({
      ok: true,
    });
  });

  it('требует текущий пароль', () => {
    const result = validatePasswordChange({ current: '', next: 'newpass1', repeat: 'newpass1' });
    expect(result.ok).toBeFalse();
    if (!result.ok) {
      expect(result.field).toBe('current');
    }
  });

  it('проверяет минимальную длину', () => {
    const result = validatePasswordChange({ current: 'oldpass', next: '12345', repeat: '12345' });
    expect(result.ok).toBeFalse();
    if (!result.ok) {
      expect(result.message).toContain('6');
    }
  });

  it('запрещает оставить тот же пароль', () => {
    const result = validatePasswordChange({
      current: 'samepass',
      next: 'samepass',
      repeat: 'samepass',
    });
    expect(result.ok).toBeFalse();
    if (!result.ok) {
      expect(result.field).toBe('next');
    }
  });

  it('ловит несовпадение повтора', () => {
    const result = validatePasswordChange({
      current: 'oldpass',
      next: 'newpass1',
      repeat: 'newpass2',
    });
    expect(result.ok).toBeFalse();
    if (!result.ok) {
      expect(result.field).toBe('repeat');
    }
  });

  it('считает пустой новый пароль ошибкой', () => {
    const result = validatePasswordChange({ current: 'oldpass', next: '', repeat: '' });
    expect(result.ok).toBeFalse();
    if (!result.ok) {
      expect(result.field).toBe('next');
    }
  });
});
