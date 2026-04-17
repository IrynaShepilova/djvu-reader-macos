import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { environment } from '../../environments/environment';
import { Observable } from 'rxjs';
import { ScanFolder } from '../interfaces/scan-folder';

interface ScanFolderResponse {
  ok: boolean;
  folder: ScanFolder;
}

@Injectable({
  providedIn: 'root'
})
export class ScanFoldersService {
  private readonly apiBase = environment.apiBase;

  constructor(private http: HttpClient) {}

  getScanFolders(): Observable<ScanFolder[]> {
    return this.http.get<ScanFolder[]>(`${this.apiBase}/api/scan-folders`);
  }

  addScanFolder(path: string): Observable<ScanFolderResponse> {
    return this.http.post<ScanFolderResponse>(`${this.apiBase}/api/scan-folders`, { path });
  }

  updateScanFolderEnabled(id: string, enabled: boolean): Observable<ScanFolderResponse> {
    return this.http.patch<ScanFolderResponse>(
      `${this.apiBase}/api/scan-folders/${encodeURIComponent(id)}`,
      { enabled }
    );
  }

  checkScanFolder(id: string): Observable<ScanFolderResponse> {
    return this.http.post<ScanFolderResponse>(
      `${this.apiBase}/api/scan-folders/check/${encodeURIComponent(id)}`,
      {}
    );
  }

  removeScanFolder(id: string): Observable<ScanFolderResponse> {
    return this.http.delete<ScanFolderResponse>(
      `${this.apiBase}/api/scan-folders/${encodeURIComponent(id)}`
    );
  }
}
