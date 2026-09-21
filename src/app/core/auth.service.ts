import { Injectable, Injector, computed, inject, runInInjectionContext, signal } from '@angular/core';
import { Auth, User, createUserWithEmailAndPassword, onAuthStateChanged, sendPasswordResetEmail, signInWithEmailAndPassword, signOut, updateProfile } from '@angular/fire/auth';
import { Firestore, doc, docData, getDoc, serverTimestamp, setDoc, updateDoc } from '@angular/fire/firestore';
import { Subscription } from 'rxjs';

import { UserProfile } from './models';
import { seedUserData } from './seed';

@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly auth = inject(Auth);
  private readonly firestore = inject(Firestore);
  private readonly injector = inject(Injector);

  /** Текущий пользователь Firebase Auth. */
  readonly user = signal<User | null>(null);
  /** Документ users/{uid} (создаётся автоматически при первом входе). */
  readonly profile = signal<UserProfile | null>(null);
  /** Auth-состояние загружено — guards ждут этого, чтобы не редиректить раньше времени. */
  readonly isReady = signal(false);

  readonly isAuthenticated = computed(() => this.user() !== null);

  private readonly readyPromise: Promise<void>;
  private profileSub?: Subscription;

  constructor() {
    this.readyPromise = new Promise<void>((resolve) => {
      onAuthStateChanged(this.auth, (user) => {
        this.user.set(user);
        if (user) {
          void this.attachProfile(user);
        } else {
          this.profileSub?.unsubscribe();
          this.profile.set(null);
        }
        this.isReady.set(true);
        resolve();
      });
    });
  }

  ensureReady(): Promise<void> {
    return this.readyPromise;
  }

  async register(email: string, password: string, displayName: string): Promise<void> {
    const cred = await createUserWithEmailAndPassword(this.auth, email.trim(), password);
    if (displayName.trim()) {
      await updateProfile(cred.user, { displayName: displayName.trim() });
    }
    // Профиль и стартовые данные создаст attachProfile, который срабатывает
    // по onAuthStateChanged — не блокируем вход приложением на записи в Firestore.
  }

  async login(email: string, password: string): Promise<void> {
    await signInWithEmailAndPassword(this.auth, email.trim(), password);
  }

  async resetPassword(email: string): Promise<void> {
    await sendPasswordResetEmail(this.auth, email.trim());
  }

  async logout(): Promise<void> {
    await signOut(this.auth);
  }

  /** Обновляет имя (в Auth и в Firestore). */
  async updateDisplayName(displayName: string): Promise<void> {
    const user = this.user();
    if (!user) {
      throw new Error('Пользователь не авторизован');
    }
    await updateDoc(this.profileRef(user.uid), { displayName });
    await updateProfile(user, { displayName });
  }

  /** Меняет валюту интерфейса (settings.currency). */
  async updateCurrency(code: string): Promise<void> {
    const user = this.user();
    if (!user) {
      throw new Error('Пользователь не авторизован');
    }
    await updateDoc(this.profileRef(user.uid), { 'settings.currency': code });
  }

  /** Читает документ профиля; если его нет — создаёт вместе со стартовыми счетами и категориями. */
  private async attachProfile(user: User): Promise<void> {
    this.profileSub?.unsubscribe();
    await this.ensureProfileDoc(user);
    // onAuthStateChanged вызывается вне injection-контекста — оборачиваем явно.
    this.profileSub = runInInjectionContext(this.injector, () =>
      docData(this.profileRef(user.uid)),
    ).subscribe((profile) => {
      this.profile.set(profile as UserProfile);
    });
  }

  private profileRef(uid: string) {
    return doc(this.firestore, 'users', uid);
  }

  private async ensureProfileDoc(user: User): Promise<void> {
    const ref = this.profileRef(user.uid);
    const snap = await getDoc(ref);
    if (!snap.exists()) {
      await setDoc(ref, {
        email: user.email ?? '',
        displayName: user.displayName ?? '',
        settings: { currency: 'RUB' },
        createdAt: serverTimestamp(),
      });
      await seedUserData(this.firestore, user.uid);
    }
  }
}
