import {
  Component,
  ElementRef,
  ViewChild,
  ViewChildren,
  QueryList,
  OnInit,
  signal,
  effect,
  OnDestroy,
  AfterViewInit
} from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Book } from '../../interfaces/book';
import { environment } from '../../../environments/environment';

declare const DjVu: any;

@Component({
  selector: 'app-reader',
  standalone: true,
  imports: [],
  templateUrl: './reader.component.html',
  styleUrl: './reader.component.scss'
})
export class ReaderComponent implements OnInit, OnDestroy, AfterViewInit {
  @ViewChildren('pageCanvas') pageCanvases!: QueryList<ElementRef<HTMLCanvasElement>>;
  @ViewChild('pagesContainer') pagesContainerRef!: ElementRef<HTMLDivElement>;
  @ViewChild('thumbsContainer') thumbsContainerRef!: ElementRef<HTMLDivElement>;

  constructor(private http: HttpClient) {
    effect(() => {
      this.renderedPages();
    });

  }

  private readonly apiBase = environment.apiBase;
  private document: any;
  currentPage = signal(1);
  visibleThumbs = signal<{ index: number; url: string }[]>([]);
  renderedPages = signal<{ index: number }[]>([]);

  totalPages = 0;

   ignoreScroll = false;
  private lastUrls: string[] = [];
  private scrollReleaseTimer: any = null;

  async ngOnInit() {
    const books = await this.loadBooks();
    if (!books?.length) return;

    await this.loadDocument(books[0]);
    this.expandWindowAround(1);
  }

  async loadBooks(): Promise<Book[]> {
    try {
      return await this.http
        .get<Book[]>(`${this.apiBase}/api/books`)
        .toPromise() || [];
    } catch (err) {
      console.error('Failed to load book list:', err);
      return [];
    }
  }

  async loadDocument(book: Book): Promise<void> {
    const fileUrl = `${this.apiBase}${book.url}`;
    const arrayBuffer = await fetch(decodeURI(fileUrl)).then(r => r.arrayBuffer());
    this.document = new DjVu.Document(arrayBuffer);
    this.totalPages = this.getTotalPages(this.document);

    this.expandWindowAround(1);
    await this.generateThumbnailsLazy();
  }

  private async generateThumbnailsLazy(): Promise<void> {
    const total = this.totalPages;
    const batch = 10;
    let i = 1;

    const load = async () => {
      const thumbs: { index: number; url: string }[] = [];
      for (let p = i; p < i + batch && p <= total; p++) {
        try {
          const page = await this.document.getPage(p);
          const img = await page.getImageData();
          const url = await this.createThumbnailUrl(img, 0.15);
          thumbs.push({ index: p, url });
        } catch (err) {
          console.warn(`There was an error rendering page ${p}:`, err);
        }
      }

      this.updateVisibleThumbs([...this.visibleThumbs(), ...thumbs]);

      i += batch;
      if (i <= total) {
        if ("requestIdleCallback" in window) {
          (window as any).requestIdleCallback(load);
        } else {
          setTimeout(load, 60);
        }
      }
    };

    await load();
  }

  private async createThumbnailUrl(img: ImageData, scale = 0.15): Promise<string> {
    const full = document.createElement('canvas');
    full.width = img.width;
    full.height = img.height;
    full.getContext('2d')!.putImageData(img, 0, 0);

    const small = document.createElement('canvas');
    small.width = img.width * scale;
    small.height = img.height * scale;
    small.getContext('2d')!.drawImage(full, 0, 0, small.width, small.height);

    const blob = await new Promise<Blob | null>(res => small.toBlob(res, 'image/jpeg', 0.6));
    if (!blob) throw new Error('Thumbnail blob failed.');

    full.width = full.height = 0;
    small.width = small.height = 0;
    return URL.createObjectURL(blob);
  }

  onThumbnailClick(page: number) {
    console.log('onThumbnailClick pageNumber', page);
    this.goToPage(page);
  }

  private scrollToPage(index: number) {
    console.log('scrollToPAGE index', index);
    queueMicrotask(() =>
      setTimeout(() => {
        const cont = this.pagesContainerRef.nativeElement;
        const el = cont.querySelector(`[data-index="${index}"]`);
        if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
      })
    );
  }

  private getTotalPages(doc: any): number {
    const candidates = [
      () => doc.getPagesCount?.(),
      () => doc.getPagesQuantity?.(),
      () => doc.pagesCount,
      () => doc.pages?.length
    ];
    for (const fn of candidates) {
      try {
        const v = fn();
        if (typeof v === 'number' && v > 0) return v;
      } catch {}
    }
    return 1;
  }

  private updateVisibleThumbs(list: { index: number; url: string }[]) {
    this.cleanupUrls(this.lastUrls);
    this.lastUrls = list.map(t => t.url);
    this.visibleThumbs.set(list);
  }

  private cleanupUrls(urls: string[]) {
    for (const u of urls) {
      try { URL.revokeObjectURL(u); } catch {}
    }
  }

  private scrollToActiveThumbnail(n: number) {
    console.log('scrollToActiveThumbnail pageNumber', n);
    console.log('this.ignoreScroll', this.ignoreScroll );
    queueMicrotask(() => {
      const cont = this.thumbsContainerRef.nativeElement;
      const el = cont.querySelector(`[data-index="${n}"]`);
      console.log('el', el);
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }

    });
  }

  private async renderStreamPages() {
    for (const p of this.renderedPages()) {
      const ref = this.pageCanvases.find(c => Number(c.nativeElement.dataset['index']) === p.index);
      if (!ref) continue;

      const canvas = ref.nativeElement;
      const page = await this.document.getPage(p.index);
      const img = await page.getImageData();

      canvas.width = img.width;
      canvas.height = img.height;
      canvas.getContext('2d')!.putImageData(img, 0, 0);
    }
  }

  private expandWindowAround(center: number) {
    const total = this.totalPages;
    const items = [];
    for (let i = center - 2; i <= center + 2; i++) {
      if (i >= 1 && i <= total) items.push({ index: i });
    }
    this.renderedPages.set(items);
  }

  private onPagesScroll = () => {
    if (this.ignoreScroll) return;

    const canvases = this.pageCanvases.toArray();
    if (!canvases.length) return;

    let best: number | null = null;
    let min = Infinity;

    const contRect = this.pagesContainerRef.nativeElement.getBoundingClientRect();

    for (const ref of canvases) {
      const el = ref.nativeElement;
      const r = el.getBoundingClientRect();
      const dist = Math.abs(r.top + r.height / 2 - (contRect.top + 150));
      if (dist < min) {
        min = dist;
        best = Number(el.dataset['index']);
      }
    }

    if (best && best !== this.currentPage()) {
      this.currentPage.set(best);
      this.expandWindowAround(best);
      if (!this.ignoreScroll) {
        this.scrollToActiveThumbnail(best);
      }    }
  };

  goPrevPage() {
    const t = this.currentPage() - 1;
    console.log('goPrevPage target', t);
    this.goToPage(t);
  }

  goFirstPage() {
    this.goToPage(1)
  }

  goLastPage() {
    console.log('this.totalPages', this.totalPages);
    this.goToPage(this.totalPages)
  }

  goNextPage() {
    const t = this.currentPage() + 1;
    console.log('goNextPage target', t);
    this.goToPage(t);
  }

  onPageInput(event: Event) {
    const el = event.target as HTMLInputElement;
    let p = Number(el.value);
    if (!p || p < 1) p = 1;
    if (p > this.totalPages) p = this.totalPages;
    el.value = String(p);
    this.goToPage(p);
  }

  async goToPage(page: number) {
    if (!this.document) return;
    if (page < 1) page = 1;
    if (page > this.totalPages) page = this.totalPages;
    // if (page === this.currentPage()) return;

    this.ignoreScroll = true;

    this.currentPage.set(page);
    this.expandWindowAround(page);

    // this.ignoreScroll = true;

    this.scrollToPage(page);
    if (!this.ignoreScroll) {
      this.scrollToActiveThumbnail(page);
    }

    if (this.scrollReleaseTimer) clearTimeout(this.scrollReleaseTimer);
    this.scrollReleaseTimer = setTimeout(() => {
      console.log('!!!!!! goToPage set timeout set ignoreScroll');
      this.ignoreScroll = false;
      this.scrollToActiveThumbnail(page);
    }, 1000);
  }

  ngAfterViewInit() {
    this.pagesContainerRef.nativeElement.addEventListener('scroll', this.onPagesScroll);
    this.pageCanvases.changes.subscribe(() => {
      console.log('pageCanvases updated → rendering pages');
      this.renderStreamPages();
    });
  }

  ngOnDestroy() {
    this.pagesContainerRef?.nativeElement.removeEventListener('scroll', this.onPagesScroll);
  }

}

