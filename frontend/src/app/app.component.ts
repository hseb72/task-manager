import { Component, OnInit, inject } from '@angular/core';
import { RouterOutlet, RouterLink, RouterLinkActive } from '@angular/router';
import { RefsService } from './services/refs.service';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [RouterOutlet, RouterLink, RouterLinkActive],
  template: `
    <div class="app-shell">
      <header class="app-header">
        <div class="brand">
          <span class="mark">Atelier des tâches</span>
          <span class="sub">— gestion interne</span>
        </div>
        <nav class="app-nav">
          <a routerLink="/" routerLinkActive="active" [routerLinkActiveOptions]="{ exact: true }">Tâches</a>
          <a routerLink="/referentiels" routerLinkActive="active">Référentiels</a>
        </nav>
      </header>
      <main class="app-main">
        <router-outlet></router-outlet>
      </main>
    </div>
  `,
})
export class AppComponent implements OnInit {
  private refs = inject(RefsService);

  ngOnInit() {
    this.refs.loadAll().subscribe({
      error: err => console.error('Erreur de chargement des référentiels :', err),
    });
  }
}
