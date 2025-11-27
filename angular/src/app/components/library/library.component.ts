import {Component, OnInit, signal, ViewChild} from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Router } from '@angular/router';
import { environment } from '../../../environments/environment';
import { Book } from '../../interfaces/book';
import {FindPreviewPipe} from '../../pipes/find-preview';
import {ReaderImgComponent} from '../reader-img/reader-img.component';

declare const DjVu: any;

@Component({
  selector: 'app-library',
  standalone: true,
  imports: [FindPreviewPipe, ReaderImgComponent],
  templateUrl: './library.component.html',
  styleUrl: './library.component.scss'
})
export class LibraryComponent implements OnInit {

  constructor(private http: HttpClient, private router: Router) {}
  @ViewChild(ReaderImgComponent)
  reader!: ReaderImgComponent;


  private readonly apiBase = environment.apiBase;

  books = signal<Book[]>([]);
  previews = signal<{ file: string; url: string }[]>([]);

  async ngOnInit() {
    const list = await this.loadBooks();
    this.books.set(list);

    this.generatePreviews(list);
  }

  async loadBooks(): Promise<Book[]> {
    try {
      return await this.http
        .get<Book[]>(`${this.apiBase}/api/books`)
        .toPromise() || [];
    } catch {
      return [];
    }
  }

  async generatePreviews(list: Book[]) {
    const result: { file: string; url: string }[] = [];

    for (const b of list) {
      try {
        const fileUrl = `${this.apiBase}${b.url}`;
        const buf = await fetch(decodeURI(fileUrl)).then(r => r.arrayBuffer());
        const doc = new DjVu.Document(buf);
        const page1 = await doc.getPage(1);
        const img = await page1.getImageData();

        const canvas = document.createElement('canvas');
        canvas.width = img.width;
        canvas.height = img.height;
        canvas.getContext('2d')!.putImageData(img, 0, 0);

        const blob = await new Promise<Blob | null>(res => canvas.toBlob(res, 'image/jpeg', 0.6));
        if (!blob) continue;

        const url = URL.createObjectURL(blob);

        result.push({ file: b.url, url });

      } catch (err) {
        console.warn(`Preview failed:`, err);
      }
    }

    this.previews.set(result);
  }

  open(file: string) {
    this.router.navigate(['/reader-img', file]);
  }

  onSelect(book: Book) {
    console.log('selected book', book);
    this.reader.open(book);
  }
}
