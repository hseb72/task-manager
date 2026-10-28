import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';

/** Paramétrage de classement des réunions (persisté en base). */
export interface MeetingConfig {
  excluded: string;
  aliases: string;
  generics: string;
  themes: string;
  recurrenceMin: number;
  personalTitles: string;
}

export interface NamedConfig {
  name: string;
  config: MeetingConfig;
  updatedAt?: string;
}

@Injectable({ providedIn: 'root' })
export class MeetingConfigsService {
  private http = inject(HttpClient);
  private base = '/api/meeting-configs';

  list(): Observable<NamedConfig[]> {
    return this.http.get<NamedConfig[]>(this.base);
  }
  save(name: string, config: MeetingConfig): Observable<NamedConfig> {
    return this.http.put<NamedConfig>(`${this.base}/${encodeURIComponent(name)}`, config);
  }
  remove(name: string): Observable<{ ok: boolean }> {
    return this.http.delete<{ ok: boolean }>(`${this.base}/${encodeURIComponent(name)}`);
  }
}
