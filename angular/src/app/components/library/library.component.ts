import {Component, computed, OnInit, signal, ViewChild} from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Router } from '@angular/router';
import { environment } from '../../../environments/environment';
import { Book } from '../../interfaces/book';
import { TabsService } from '../../services/tabs.service';
import { MatDialog } from '@angular/material/dialog';
import { DialogComponent } from '../dialog/dialog.component';
import {TabsBarComponent} from '../tabs-bar/tabs-bar.component';


declare const DjVu: any;
type LibraryViewMode = 'tile' | 'list';

@Component({
  selector: 'app-library',
  standalone: true,
  imports: [
    TabsBarComponent
  ],
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

  isScanning = signal(false);
  scanProgress = signal(0);
  scanProcessed = signal(0);
  scanTotal = signal(0);
  private scanPollTimer: any = null;

  booksCount = computed(() => this.books().length);

  private previewCache = new Map<string, string>(); // book.id -> objectUrl
  private previewInFlight = new Set<string>();
  previewMap = signal<Record<string, string>>({});

  private previewsRunId = 0;

  private readonly LS_VIEW_MODE = 'djvu.library.viewMode.v1';
  viewMode: LibraryViewMode = (localStorage.getItem(this.LS_VIEW_MODE) as LibraryViewMode) || 'tile';

  async ngOnInit() {
    const list = await this.loadBooks();
    this.books.set(list);

    await this.generatePreviews(list);
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

  async generatePreviews(list: Book[], concurrency = 3) {
    const runId = ++this.previewsRunId;
    const initial: Record<string, string> = {};

    for (const b of list) {
      if (b.cover) {
        initial[b.id] = `${this.apiBase}${b.cover}`;
        continue;
      }

      const cached = this.previewCache.get(b.id);
      if (cached) {
        initial[b.id] = cached;
      }
    }

    this.previewMap.set(initial);

    const queue = list.filter(b =>
      !b.cover &&
      !this.previewCache.has(b.id) &&
      !this.previewInFlight.has(b.id)
    );

    let idx = 0;

    const worker = async () => {
      while (idx < queue.length) {
        if (runId !== this.previewsRunId) return; // отмена старого запуска

        const b = queue[idx++];
        this.previewInFlight.add(b.id);

        try {
          const url = await this.buildPreview(b);
          if (runId !== this.previewsRunId) return;

          this.previewCache.set(b.id, url);
          this.previewMap.update(m => ({ ...m, [b.id]: url }));
        } catch (e) {
          console.warn('Preview failed', b, e);
        } finally {
          this.previewInFlight.delete(b.id);
        }
      }
    };

    await Promise.all(Array.from({ length: concurrency }, worker));
  }

  private async buildPreview(b: Book): Promise<string> {
    const fileUrl = `${this.apiBase}${b.url}`;
    const buf = await fetch(decodeURI(fileUrl)).then(r => r.arrayBuffer());
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
      await this.uploadCover(b.id, blob);
    } catch (e) {
      console.warn('Cover upload failed (non-blocking)', e);
    }

    return URL.createObjectURL(blob);
  }

  private async uploadCover(bookId: string, blob: Blob): Promise<void> {
    const fd = new FormData();
    fd.append('cover', blob, 'cover.jpg');

    await fetch(`${this.apiBase}/api/books/${encodeURIComponent(bookId)}/cover`, {
      method: 'POST',
      body: fd,
    });
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
    await this.generatePreviews(list);
  }

  setViewMode(mode: LibraryViewMode) {
    this.viewMode = mode;
    localStorage.setItem(this.LS_VIEW_MODE, mode);
  }

  toggleViewMode() {
    this.setViewMode(this.viewMode === 'tile' ? 'list' : 'tile');
  }

}
