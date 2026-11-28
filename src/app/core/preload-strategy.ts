import { Injectable } from '@angular/core';
import { PreloadingStrategy, Route } from '@angular/router';
import { Observable, of } from 'rxjs';

/**
 * Предзагружаем разделы в фоне, кроме «Статистики»: там Chart.js (~240 КБ),
 * и тянуть его на старте незачем. Откроется — загрузится.
 */
@Injectable({ providedIn: 'root' })
export class AppPreloadStrategy implements PreloadingStrategy {
  preload(route: Route, load: () => Observable<unknown>): Observable<unknown> {
    if (route.path === 'stats') {
      return of(null);
    }
    return load();
  }
}
