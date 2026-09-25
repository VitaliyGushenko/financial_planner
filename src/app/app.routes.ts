import { Routes } from '@angular/router';

import { authGuard, guestGuard } from './core/auth.guard';

export const routes: Routes = [
  {
    path: 'auth',
    canActivate: [guestGuard],
    loadComponent: () => import('./pages/auth/auth.component').then((m) => m.AuthComponent),
    title: 'Вход — Планировщик финансов',
  },
  {
    path: '',
    canActivate: [authGuard],
    children: [
      {
        path: '',
        loadComponent: () => import('./pages/dashboard/dashboard.component').then((m) => m.DashboardComponent),
        title: 'Дашборд — Планировщик финансов',
      },
      {
        path: 'operations',
        loadComponent: () => import('./pages/operations/operations.component').then((m) => m.OperationsComponent),
        title: 'Операции — Планировщик финансов',
      },
      {
        path: 'calendar',
        loadComponent: () => import('./pages/calendar/calendar.component').then((m) => m.CalendarComponent),
        title: 'Календарь — Планировщик финансов',
      },
      {
        path: 'stats',
        loadComponent: () => import('./pages/stats/stats.component').then((m) => m.StatsComponent),
        title: 'Статистика — Планировщик финансов',
      },
      {
        path: 'planner',
        loadComponent: () => import('./pages/planner/planner.component').then((m) => m.PlannerComponent),
        title: 'Планировщик покупок — Планировщик финансов',
      },
      {
        path: 'settings',
        loadComponent: () => import('./pages/settings/settings.component').then((m) => m.SettingsComponent),
        title: 'Настройки — Планировщик финансов',
      },
    ],
  },
  { path: 'recurring', redirectTo: 'operations' },
  { path: '**', redirectTo: '' },
];
