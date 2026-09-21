const messages: Record<string, string> = {
  'auth/invalid-credential': 'Неверный email или пароль.',
  'auth/user-not-found': 'Пользователь с таким email не найден.',
  'auth/wrong-password': 'Неверный email или пароль.',
  'auth/email-already-in-use': 'Этот email уже зарегистрирован.',
  'auth/weak-password': 'Пароль слишком короткий — минимум 6 символов.',
  'auth/invalid-email': 'Некорректный email.',
  'auth/missing-password': 'Введите пароль.',
  'auth/too-many-requests': 'Слишком много попыток. Попробуйте позже.',
  'auth/network-request-failed': 'Ошибка сети. Проверьте подключение к интернету.',
  'auth/user-disabled': 'Аккаунт заблокирован.',
};

export function firebaseErrorMessage(error: unknown): string {
  const code = (error as { code?: string })?.code ?? '';
  return messages[code] ?? 'Что-то пошло не так. Попробуйте ещё раз.';
}
