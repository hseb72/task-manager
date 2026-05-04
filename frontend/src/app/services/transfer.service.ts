import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Observable, from, switchMap } from 'rxjs';

export interface ImportResult {
  ok: boolean;
  mode: 'replace' | 'merge';
  version?: number | null;
  exportedAt?: string | null;
  counts: Record<string, number>;
}

@Injectable({ providedIn: 'root' })
export class TransferService {
  private http = inject(HttpClient);

  /** Télécharge l'export de la base et déclenche un téléchargement local. */
  downloadExport(): void {
    this.http.get('/api/export', { responseType: 'blob', observe: 'response' })
      .subscribe(resp => {
        const blob = resp.body!;
        const url = URL.createObjectURL(blob);

        const cd = resp.headers.get('content-disposition') ?? '';
        const m = /filename="([^"]+)"/.exec(cd);
        const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
        const fallback = `tasks-export-${stamp}.json.gz`;
        const filename = m ? m[1] : fallback;

        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
      });
  }

  /**
   * Importe un fichier d'export (.json.gz ou .json).
   * Le fichier est lu en ArrayBuffer puis envoyé comme corps binaire brut
   * pour éviter toute ambiguïté de Content-Type ou de multipart.
   */
  importFile(file: File, mode: 'replace' | 'merge'): Observable<ImportResult> {
    const headers = new HttpHeaders({
      'Content-Type': 'application/octet-stream',
    });
    return from(file.arrayBuffer()).pipe(
      switchMap(buf =>
        this.http.post<ImportResult>(
          `/api/import?mode=${mode}`, buf, { headers }
        )
      )
    );
  }
}

