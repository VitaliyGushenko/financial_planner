import { ApplicationConfig, provideZoneChangeDetection } from '@angular/core';
import { provideRouter, withViewTransitions } from '@angular/router';
import { getApp, initializeApp, provideFirebaseApp } from '@angular/fire/app';
import { getAuth, provideAuth } from '@angular/fire/auth';
import { initializeFirestore, provideFirestore } from '@angular/fire/firestore';
import { getAnalytics, provideAnalytics } from '@angular/fire/analytics';

import { routes } from './app.routes';
import { environment } from '../environments/environment';

export const appConfig: ApplicationConfig = {
  providers: [
    provideZoneChangeDetection({ eventCoalescing: true }),
    provideRouter(routes, withViewTransitions()),
    provideFirebaseApp(() => initializeApp(environment.firebase)),
    provideAnalytics(() => getAnalytics()),
    provideAuth(() => getAuth()),
    // Пустые поля форм пишем как undefined — выключаем ругань Firestore на них.
    provideFirestore(() => initializeFirestore(getApp(), { ignoreUndefinedProperties: true })),
  ],
};
