import { Injectable, inject, signal } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable, tap, forkJoin, of, catchError } from 'rxjs';
import {
  ReferenceTableMeta, RefRow,
  SimpleRef, ServiceRef, ContactRef,
} from '../models/models';

/** Résultat paginé d'un référentiel (tri / recherche côté serveur). */
export interface PagedResult<T = RefRow> {
  rows: T[];
  total: number;
  page: number;
  pageSize: number;
  pageCount: number;
}

export interface ListQuery {
  page: number;
  pageSize: number;
  sort?: string | null;
  dir?: 'asc' | 'desc';
  q?: string;
  /** Filtres par colonne : { clé → valeur } envoyés en `f_<clé>`. */
  filters?: Record<string, string>;
}

@Injectable({ providedIn: 'root' })
export class RefsService {
  private http = inject(HttpClient);
  private base = '/api/refs';

  readonly tables   = signal<ReferenceTableMeta[]>([]);
  readonly entites  = signal<SimpleRef[]>([]);
  readonly services = signal<ServiceRef[]>([]);
  readonly contacts = signal<ContactRef[]>([]);
  readonly roles    = signal<SimpleRef[]>([]);
  readonly etats    = signal<SimpleRef[]>([]);
  readonly domaines = signal<SimpleRef[]>([]);

  loadAll(): Observable<unknown> {
    // Chaque requête est isolée : l'échec d'un référentiel ne doit pas faire
    // échouer tout le forkJoin ni vider le menu latéral.
    const safe = <T>(url: string, fallback: T): Observable<T> =>
      this.http.get<T>(url).pipe(catchError(() => of(fallback)));
    return forkJoin({
      tables:   safe<ReferenceTableMeta[]>(this.base, []),
      entites:  safe<SimpleRef[]>(`${this.base}/entites`, []),
      services: safe<ServiceRef[]>(`${this.base}/services`, []),
      contacts: safe<ContactRef[]>(`${this.base}/contacts`, []),
      roles:    safe<SimpleRef[]>(`${this.base}/roles`, []),
      etats:    safe<SimpleRef[]>(`${this.base}/etats`, []),
      domaines: safe<SimpleRef[]>(`${this.base}/domaines`, []),
    }).pipe(tap(r => {
      this.tables.set(r.tables);
      this.entites.set(r.entites);
      this.services.set(r.services);
      this.contacts.set(r.contacts);
      this.roles.set(r.roles);
      this.etats.set(r.etats);
      this.domaines.set(r.domaines);
    }));
  }

  list(table: string): Observable<RefRow[]> {
    return this.http.get<RefRow[]>(`${this.base}/${table}`);
  }

  /** Recharge la liste complète d'un référentiel et met à jour son signal (listes déroulantes). */
  reload(table: string): Observable<RefRow[]> {
    return this.list(table).pipe(tap(vs => this.refreshSignal(table, vs)));
  }

  /** Liste paginée / triée / recherchée (côté serveur). */
  listPaged(table: string, opts: ListQuery): Observable<PagedResult> {
    let params = new HttpParams()
      .set('page', String(opts.page))
      .set('pageSize', String(opts.pageSize));
    if (opts.sort) params = params.set('sort', opts.sort).set('dir', opts.dir ?? 'asc');
    if (opts.q && opts.q.trim()) params = params.set('q', opts.q.trim());
    for (const [k, v] of Object.entries(opts.filters ?? {})) {
      if (v !== '' && v != null) params = params.set('f_' + k, v);
    }
    return this.http.get<PagedResult>(`${this.base}/${table}`, { params });
  }
  create(table: string, body: Partial<RefRow>): Observable<RefRow> {
    return this.http.post<RefRow>(`${this.base}/${table}`, body);
  }
  update(table: string, id: number, body: Partial<RefRow>): Observable<RefRow> {
    return this.http.put<RefRow>(`${this.base}/${table}/${id}`, body);
  }
  delete(table: string, id: number): Observable<void> {
    return this.http.delete<void>(`${this.base}/${table}/${id}`);
  }

  refreshSignal(table: string, values: RefRow[]) {
    switch (table) {
      case 'entites':  this.entites.set(values as SimpleRef[]);  break;
      case 'services': this.services.set(values as ServiceRef[]); break;
      case 'contacts': this.contacts.set(values as ContactRef[]); break;
      case 'roles':    this.roles.set(values as SimpleRef[]);    break;
      case 'etats':    this.etats.set(values as SimpleRef[]);    break;
      case 'domaines': this.domaines.set(values as SimpleRef[]); break;
    }
  }
}
