import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { Book } from '../interfaces/book';

@Injectable({
  providedIn: 'root'
})
export class BookService {
  private apiUrl = 'http://localhost:3000/api/books';

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

}
