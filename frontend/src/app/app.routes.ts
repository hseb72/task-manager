import { Routes } from '@angular/router';

export const routes: Routes = [
  {
    path: '',
    loadComponent: () =>
      import('./pages/taches-page/taches-page.component').then(m => m.TachesPageComponent),
  },
  {
    path: 'referentiels',
    loadComponent: () =>
      import('./pages/refs-page/refs-page.component').then(m => m.RefsPageComponent),
  },
  {
    path: 'referentiels/:table',
    loadComponent: () =>
      import('./pages/refs-page/refs-page.component').then(m => m.RefsPageComponent),
  },
  { path: '**', redirectTo: '' },
];
