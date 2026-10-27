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
  {
    path: 'reunions',
    loadComponent: () =>
      import('./pages/meetings-page/meetings-page.component').then(m => m.MeetingsPageComponent),
  },
  { path: '**', redirectTo: '' },
];
