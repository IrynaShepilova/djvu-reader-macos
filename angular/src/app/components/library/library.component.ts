import {Component, computed, OnInit, signal, ViewChild} from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Router } from '@angular/router';
import { environment } from '../../../environments/environment';
import { Book } from '../../interfaces/book';
import {FindPreviewPipe} from '../../pipes/find-preview';
import { TabsService } from '../../services/tabs.service';
import { MatDialog } from '@angular/material/dialog';
import { DialogComponent } from '../dialog/dialog.component';


declare const DjVu: any;

@Component({
  selector: 'app-library',
  standalone: true,
  imports: [FindPreviewPipe],
  templateUrl: './library.component.html',
  styleUrl: './library.component.scss'
})
export class LibraryComponent implements OnInit {

  constructor(
    private http: HttpClient,
    private router: Router,
    private tabsService: TabsService,
    private dialog: MatDialog,
  ) {}


  private readonly apiBase = environment.apiBase;

  books = signal<Book[]>([]);
  previews = signal<{ file: string; url: string }[]>([]);

  isScanning = signal(false);
  scanProgress = signal(0);
  scanProcessed = signal(0);
  scanTotal = signal(0);
  private scanPollTimer: any = null;

  booksCount = computed(() => this.books().length);


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
    this.router.navigate(['/reader', file]);
  }

  openBook(book: Book) {
    const tabId = this.tabsService.openBook(book);
    this.router.navigate(['/reader', tabId]);
  }

  addBook() {

  }

  async scanLibrary() {
    if (this.isScanning()) return;

    this.isScanning.set(true);
    this.scanProgress.set(0);
    this.scanProcessed.set(0);
    this.scanTotal.set(0);

    try {
      await this.http.post(`${this.apiBase}/api/books/scan/start`, {}).toPromise();

      // polling
      this.scanPollTimer = setInterval(async () => {
        const st = await this.http
          .get<any>(`${this.apiBase}/api/books/scan/status`)
          .toPromise();

        if (!st) return;

        this.scanProgress.set(st.percent ?? 0);
        this.scanProcessed.set(st.processed ?? 0);
        this.scanTotal.set(st.total ?? 0);

        if (st.done && !st.running) {
          clearInterval(this.scanPollTimer);
          this.scanPollTimer = null;

          this.isScanning.set(false);

          this.dialog.open(DialogComponent, {
            width: '420px',
            data: {
              title: 'Scan complete',
              message: `Added: ${st.added ?? 0}. Total: ${st.total ?? this.books().length}`,
              // items: (st.newBooks ?? []).map((b: any) => b.title)
            }
          });
          await this.refreshLibrary();
        }
      }, 300);

    } catch (e) {
      console.error(e);
      this.isScanning.set(false);
      if (this.scanPollTimer) {
        clearInterval(this.scanPollTimer);
        this.scanPollTimer = null;
      }
      this.dialog.open(DialogComponent, {
        width: '420px',
        data: {
          title: 'Scan failed',
          message: `There was an error scanning the library.`,
        }
      });

    }
  }


  async refreshLibrary() {
    const list = await this.loadBooks();
    this.books.set(list);
    this.generatePreviews(list);
  }


}
