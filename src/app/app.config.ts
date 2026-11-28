import { ApplicationConfig, ErrorHandler, isDevMode, provideZoneChangeDetection } from '@angular/core';
import { provideRouter, withPreloading, withViewTransitions } from '@angular/router';
import { provideServiceWorker } from '@angular/service-worker';
import { getApp, initializeApp, provideFirebaseApp } from '@angular/fire/app';
import { getAuth, provideAuth } from '@angular/fire/auth';
import { initializeFirestore, provideFirestore } from '@angular/fire/firestore';
import { getAnalytics, provideAnalytics } from '@angular/fire/analytics';
import { persistentLocalCache, persistentMultipleTabManager } from 'firebase/firestore';

import { routes } from './app.routes';
import { environment } from '../environments/environment';
import { AppErrorHandler } from './core/app-error-handler';
import { AppPreloadStrategy } from './core/preload-strategy';

export const appConfig: ApplicationConfig = {
  providers: [
    { provide: ErrorHandler, useClass: AppErrorHandler },
    provideZoneChangeDetection({ eventCoalescing: true }),
    provideRouter(routes, withViewTransitions({ skipInitialTransition: true }), withPreloading(AppPreloadStrategy)),
    provideFirebaseApp(() => initializeApp(environment.firebase)),
    provideAnalytics(() => getAnalytics()),
    provideAuth(() => getAuth()),
    // Пустые поля форм пишем как undefined — выключаем ругань Firestore на них.
    // Плюс постоянный кэш: офлайн-чтение и очередь записи между вкладками.
    provideFirestore(() =>
      initializeFirestore(getApp(), {
        ignoreUndefinedProperties: true,
        localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
      }),
    ),
    // PWA: в dev-режиме service worker не нужен — он кэшировал бы сборку.
    provideServiceWorker('ngsw-worker.js', {
      enabled: !isDevMode(),
      registrationStrategy: 'registerWhenStable:30000',
    }),
  ],
};

