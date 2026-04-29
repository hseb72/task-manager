import { Injectable, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, tap, forkJoin } from 'rxjs';
import {
  ReferenceTableMeta, RefRow,
  SimpleRef, ServiceRef, ContactRef,
} from '../models/models';

@Injectable({ providedIn: 'root' })
export class RefsService {
  private http = inject(HttpClient);
  private base = '/api/refs';

  /** Cache global, alimenté par loadAll(). */
  readonly tables   = signal<ReferenceTableMeta[]>([]);
  readonly entites  = signal<SimpleRef[]>([]);
  readonly services = signal<ServiceRef[]>([]);
  readonly contacts = signal<ContactRef[]>([]);
  readonly etats    = signal<SimpleRef[]>([]);
  readonly domaines = signal<SimpleRef[]>([]);

  loadAll(): Observable<unknown> {
    return forkJoin({
      tables:   this.http.get<ReferenceTableMeta[]>(this.base),
      entites:  this.http.get<SimpleRef[]>(`${this.base}/entites`),
      services: this.http.get<ServiceRef[]>(`${this.base}/services`),
      contacts: this.http.get<ContactRef[]>(`${this.base}/contacts`),
      etats:    this.http.get<SimpleRef[]>(`${this.base}/etats`),
      domaines: this.http.get<SimpleRef[]>(`${this.base}/domaines`),
    }).pipe(tap(r => {
      this.tables.set(r.tables);
      this.entites.set(r.entites);
      this.services.set(r.services);
      this.contacts.set(r.contacts);
      this.etats.set(r.etats);
      this.domaines.set(r.domaines);
    }));
  }

  list(table: string): Observable<RefRow[]> {
    return this.http.get<RefRow[]>(`${this.base}/${table}`);
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

  /** Met à jour le signal correspondant à un référentiel. */
  refreshSignal(table: string, values: RefRow[]) {
    switch (table) {
      case 'entites':  this.entites.set(values as SimpleRef[]);  break;
      case 'services': this.services.set(values as ServiceRef[]); break;
      case 'contacts': this.contacts.set(values as ContactRef[]); break;
      case 'etats':    this.etats.set(values as SimpleRef[]);    break;
      case 'domaines': this.domaines.set(values as SimpleRef[]); break;
    }
  }
}