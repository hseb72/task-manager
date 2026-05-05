import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { Tache, Action, TacheContact } from '../models/models';

@Injectable({ providedIn: 'root' })
export class TacheService {
  private http = inject(HttpClient);
  private base = '/api/taches';

  list(): Observable<Tache[]> {
    return this.http.get<Tache[]>(this.base);
  }
  get(id: number): Observable<Tache> {
    return this.http.get<Tache>(`${this.base}/${id}`);
  }
  create(t: Partial<Tache>): Observable<Tache> {
    return this.http.post<Tache>(this.base, t);
  }
  update(id: number, t: Partial<Tache>): Observable<Tache> {
    return this.http.put<Tache>(`${this.base}/${id}`, t);
  }
  delete(id: number): Observable<void> {
    return this.http.delete<void>(`${this.base}/${id}`);
  }

  // Actions
  listActions(tacheId: number): Observable<Action[]> {
    return this.http.get<Action[]>(`${this.base}/${tacheId}/actions`);
  }
  addAction(tacheId: number, a: Partial<Action>): Observable<Action> {
    return this.http.post<Action>(`${this.base}/${tacheId}/actions`, a);
  }
  updateAction(tacheId: number, actionId: number, a: Partial<Action>): Observable<Action> {
    return this.http.put<Action>(`${this.base}/${tacheId}/actions/${actionId}`, a);
  }
  deleteAction(tacheId: number, actionId: number): Observable<void> {
    return this.http.delete<void>(`${this.base}/${tacheId}/actions/${actionId}`);
  }

  // Contacts liés à la tâche (avec rôle porté par la liaison)
  listContacts(tacheId: number): Observable<TacheContact[]> {
    return this.http.get<TacheContact[]>(`${this.base}/${tacheId}/contacts`);
  }
  /** Lie un contact (et son rôle optionnel). Renvoie la liste à jour. */
  linkContact(tacheId: number, contactId: number, roleId: number | null = null): Observable<TacheContact[]> {
    return this.http.post<TacheContact[]>(
      `${this.base}/${tacheId}/contacts`, { contactId, roleId }
    );
  }
  /** Met à jour le rôle d'une liaison existante. */
  updateContactRole(tacheId: number, contactId: number, roleId: number | null): Observable<TacheContact[]> {
    return this.http.put<TacheContact[]>(
      `${this.base}/${tacheId}/contacts/${contactId}`, { roleId }
    );
  }
  unlinkContact(tacheId: number, contactId: number): Observable<void> {
    return this.http.delete<void>(`${this.base}/${tacheId}/contacts/${contactId}`);
  }
}
