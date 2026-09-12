import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { Book } from '../interfaces/book';
import {environment} from '../../environments/environment';
import { DocumentService } from './document.service';

export interface MissingBooksResponse {
  count: number;
  books: Book[];
}

@Injectable({
  providedIn: 'root'
})
export class BookService {
  private apiUrl = 'http://localhost:3000/api/books';
  private readonly apiBase = environment.apiBase;

  constructor(
    private http: HttpClient,
    private documents: DocumentService,
  ) {}

  getBooks(): Observable<Book[]> {
    return this.http.get<Book[]>(this.apiUrl);
  }

  markInvalid(id: string) {
    return this.http.post(
      `${this.apiUrl}/${encodeURIComponent(id)}/invalid`,
      {}
    );
  }

  updateBookMeta(id: string, patch: Partial<Book>) {
    return this.http.patch<{ ok: boolean; book: Book }>(
      `${this.apiUrl}/${encodeURIComponent(id)}/meta`,
      patch
    );
  }

  uploadCover(id: string, file: File) {
    const formData = new FormData();

    formData.append('cover', file, file.name);

    return this.http.post<{
      ok: boolean;
      coverUrl: string;
    }>(
      `${this.apiUrl}/${encodeURIComponent(id)}/cover`,
      formData,
    );
  }

  async uploadCoverBlob(bookId: string, blob: Blob): Promise<void> {
    const fd = new FormData();
    fd.append('cover', blob, 'cover.jpg');

    await fetch(`${this.apiUrl}/${encodeURIComponent(bookId)}/cover`, {
      method: 'POST',
      body: fd,
    });
  }

  deleteCover(id: string) {
    return this.http.delete<{
      ok: boolean;
      id: string;
      cover: null;
    }>(
      `${this.apiUrl}/${encodeURIComponent(id)}/cover`,
    );
  }

  async buildPreview(b: Book, uploadCover = true): Promise<string> {
    const fileUrl = `${this.apiBase}${b.url}`;
    const doc = await this.documents.load(b, fileUrl);
    let blob: Blob;

    try {
      blob = (await doc.renderPage(1, {
        targetWidth: 400,
        mimeType: 'image/jpeg',
        quality: 0.55,
      })).blob;
    } finally {
      await doc.destroy();
    }

    try {
      if (uploadCover) {
        try {
          await this.uploadCoverBlob(b.id, blob);
        } catch (e) {
          console.warn('Cover upload failed', e);
        }
      }
    } catch (e) {
      console.warn('Cover upload failed (non-blocking)', e);
    }

    return URL.createObjectURL(blob);
  }

  addBookByPath(filePath: string): Observable<Book> {
    return this.http.post<Book>(
      `${this.apiUrl}/add-by-path`,
      { path: filePath },
    );
  }

  hideBook(id: string) {
    return this.http.post<{ ok: boolean; book: Book }>(
      `${this.apiUrl}/${encodeURIComponent(id)}/hide`,
      {}
    );
  }

  deleteBook(id: string) {
    return this.http.delete<{ ok: boolean; id: string }>(
      `${this.apiUrl}/${encodeURIComponent(id)}`
    );
  }

  getMissingBooks(): Observable<MissingBooksResponse> {
    return this.http.get<MissingBooksResponse>(
      `${this.apiUrl}/missing`
    );
  }
}
