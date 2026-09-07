import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { Book } from '../interfaces/book';
import {environment} from '../../environments/environment';

declare const DjVu: any;

@Injectable({
  providedIn: 'root'
})
export class BookService {
  private apiUrl = 'http://localhost:3000/api/books';
  private readonly apiBase = environment.apiBase;

  constructor(private http: HttpClient) {}

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
    const buf = await fetch(fileUrl).then(r => r.arrayBuffer());
    const doc = new (DjVu as any).Document(buf);
    const page1 = await doc.getPage(1);
    const img = await page1.getImageData();

    const srcCanvas = document.createElement('canvas');
    srcCanvas.width = img.width;
    srcCanvas.height = img.height;
    srcCanvas.getContext('2d')!.putImageData(img, 0, 0);

    const targetW = 400;
    const scale = targetW / img.width;
    const targetH = Math.max(1, Math.round(img.height * scale));

    const dstCanvas = document.createElement('canvas');
    dstCanvas.width = targetW;
    dstCanvas.height = targetH;

    const ctx = dstCanvas.getContext('2d')!;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';

    ctx.drawImage(srcCanvas, 0, 0, targetW, targetH);

    const blob = await new Promise<Blob | null>(res =>
      dstCanvas.toBlob(res, 'image/jpeg', 0.55)
    );
    if (!blob) throw new Error('toBlob failed');

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
}
