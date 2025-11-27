import {
  AfterViewInit,
  Component, effect, ElementRef,
  OnInit,
  signal, ViewChild
} from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { environment } from '../../../environments/environment';
import { Book } from '../../interfaces/book';
import {NgOptimizedImage} from '@angular/common';

declare const DjVu: any;

@Component({
  selector: 'app-reader-img',
  standalone: true,
  imports: [

  ],
  templateUrl: './reader-img.component.html',
  styleUrl: './reader-img.component.scss',
})
export class ReaderImgComponent implements OnInit, AfterViewInit {

  constructor(private http: HttpClient) {
    effect(() => {
      const page = this.currentPage();
      queueMicrotask(() => this.scrollToActiveThumbnail(page));
    });
  }

  @ViewChild('thumbsContainer') thumbsContainerRef!: ElementRef<HTMLDivElement>;

  private readonly apiBase = environment.apiBase;

  document: any;
  totalPages = 0;

  pages = signal<{ index: number; url: string }[]>([]);
  thumbs = signal<{ index: number; url: string }[]>([]);
  currentPage = signal(1);
  allPages = signal<{ index: number; url: string; width: number; height: number }[]>([]);
  loadingProgress = signal(0);
  loadingDone = signal(false);
  private cancelLoading = false;


  async ngOnInit() {
    console.log('reader-img', );

  }

  async open(book: Book) {
    console.log('open book', book );
    this.cancelLoading = true;
    await Promise.resolve();
    this.cancelLoading = false;

    this.clearAll()

    await this.loadDocument(book);
  }

  async loadDocument(book: Book): Promise<void> {
    const fileUrl = `${this.apiBase}${book.url}`;
    const buf = await fetch(decodeURI(fileUrl)).then(r => r.arrayBuffer());
    this.document = new DjVu.Document(buf);
    console.log('this.document ', this.document );
    this.totalPages = this.getTotalPages(this.document);
    console.log('this.totalPages', this.totalPages);
    this.loadAllPagesAsImagesBatch();
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

  async loadAllPagesAsImagesBatch(batchSize = 10) {
    if (!this.document) return;

    const total = this.totalPages;
    let i = 1;

    const loadBatch = async () => {
      const batch: { index: number; url: string; width: number; height: number }[] = [];

      for (let p = i; p < i + batchSize && p <= total; p++) {
        if (this.cancelLoading) return;

        try {
          const page = await this.document.getPage(p);
          const imgData = await page.getImageData();
          const url = await this.imageDataToUrl(imgData);

          batch.push({
            index: p,
            url,
            width: imgData.width,
            height: imgData.height
          });

        } catch (err) {
          console.warn(`Error loading page ${p}:`, err);
        }
      }

      this.allPages.update(arr => [...arr, ...batch]);

      const loaded = Math.min(i + batchSize - 1, total);
      this.loadingProgress.set(Math.round((loaded / total) * 100));

      i += batchSize;

      if (i <= total) {
        if ('requestIdleCallback' in window) {
          (window as any).requestIdleCallback(loadBatch);
        } else {
          setTimeout(loadBatch, 0);
        }
      } else {
        this.loadingDone.set(true);
      }
    };

    await loadBatch();
  }

  private async imageDataToUrl(imgData: ImageData): Promise<string> {
    const canvas = document.createElement('canvas');
    canvas.width = imgData.width;
    canvas.height = imgData.height;
    canvas.getContext('2d')!.putImageData(imgData, 0, 0);

    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, 'image/jpeg', 0.85)
    );

    if (!blob) throw new Error('Failed to convert ImageData to Blob');

    return URL.createObjectURL(blob);
  }

  onThumbClick(index: number) {
    console.log('thumb clicked', index);
    this.currentPage.set(index);
    this.scrollToPage(index);
  }

  private scrollToPage(index: number) {
    queueMicrotask(() => {
      const container = document.querySelector('.pages');
      if (!container) return;

      const el = container.querySelector<HTMLImageElement>(`.page-img:nth-of-type(${index})`);
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    });
  }


  goFirstPage() {
    this.currentPage.set(1);
    this.scrollToPage(1);
    this.scrollToActiveThumbnail(1);  }

  goLastPage() {
    const last = this.allPages().length;
    this.currentPage.set(last);
    this.scrollToPage(last);
    this.scrollToActiveThumbnail(last);  }

  goPrevPage() {
    const p = Math.max(1, this.currentPage() - 1);
    this.currentPage.set(p);
    this.scrollToPage(p);
    this.scrollToActiveThumbnail(p);
  }

  goNextPage() {
    const p = Math.min(this.totalPages, this.currentPage() + 1);
    this.currentPage.set(p);
    this.scrollToPage(p);
    this.scrollToActiveThumbnail(p);
  }

  onPageInput(event: Event) {
    const el = event.target as HTMLInputElement;
    let p = Number(el.value);

    if (!p || p < 1) p = 1;
    if (p > this.totalPages) p = this.totalPages;

    el.value = String(p);
    this.goToPage(p);
  }

  goToPage(page: number) {
    if (page < 1) page = 1;
    if (page > this.totalPages) page = this.totalPages;

    this.currentPage.set(page);

    this.scrollToPage(page);
    this.scrollToActiveThumbnail(page);
  }

  onInputFocus(input: HTMLInputElement) {
    input.select();
  }

  scrollToActiveThumbnail(index: number) {
    const cont = this.thumbsContainerRef?.nativeElement;
    if (!cont) return;

    const el = cont.querySelector(`[data-index="${index}"]`);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }

  ngAfterViewInit() {
    const container = document.querySelector('.pages') as HTMLElement;

    container.addEventListener('scroll', () => {
      this.detectCurrentPageOnScroll();
    });
  }

  detectCurrentPageOnScroll() {
    const container = document.querySelector('.pages') as HTMLElement;
    const imgs = Array.from(container.querySelectorAll('.page-img')) as HTMLImageElement[];

    let bestIndex = this.currentPage();
    let bestDist = Infinity;

    for (const img of imgs) {
      const rect = img.getBoundingClientRect();
      const center = window.innerHeight / 2;
      const pageCenter = rect.top + rect.height / 2;
      const d = Math.abs(center - pageCenter);

      if (d < bestDist) {
        bestDist = d;
        bestIndex = Number(img.getAttribute('alt'));
      }
    }

    if (bestIndex !== this.currentPage()) {
      this.currentPage.set(bestIndex);
      this.scrollToActiveThumbnail(bestIndex);
    }
  }


  private clearAll() {
    this.document = null;
    this.totalPages = 0;
    this.pages.set([]);
    this.currentPage.set(1);
    this.loadingProgress.set(0);
    this.loadingDone.set(false);
    this.thumbs.set([]);
    this.allPages.set([]);
    Promise.resolve();
    console.log('this', this);
  }
}
