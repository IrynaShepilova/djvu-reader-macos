import {
  AfterViewInit,
  Component, ElementRef, Input, OnChanges, OnDestroy, OnInit, ViewChild
} from '@angular/core';
import { environment } from '../../../environments/environment';
import {TabState} from '../../interfaces/tabState';

@Component({
  selector: 'app-reader-img',
  standalone: true,
  imports: [

  ],
  templateUrl: './reader-img.component.html',
  styleUrl: './reader-img.component.scss',
})
export class ReaderImgComponent implements OnInit, AfterViewInit, OnChanges, OnDestroy {

  constructor() {
  }

  @ViewChild('pagesContainer') pagesRef!: ElementRef<HTMLDivElement>;
  @ViewChild('thumbsContainer') thumbsContainerRef!: ElementRef<HTMLDivElement>;
  @Input() state!: TabState;

  private readonly apiBase = environment.apiBase;
  private prevPageCount = 0;
  private prevTabCurrentPage = 0;

  async ngOnInit() {
    console.log('reader-img', );
  }


  onThumbClick(index: number) {
    console.log('thumb clicked', index);
    this.state.currentPage = index;
    this.scrollToPage(index);
  }


  scrollToPage(index: number, smooth: boolean = true) {
    queueMicrotask(() => {
      const container = this.pagesRef?.nativeElement;
      if (!container) return;

      const el = container.querySelector<HTMLImageElement>(
        `[data-index="${index}"]`
      );
      if (!el) return;

      el.scrollIntoView({
        behavior: smooth ? 'smooth' : 'auto',
        block: 'start'
      });

    });
  }

  goFirstPage() {
    this.state.currentPage = this.normalizePage(1);
    this.scrollToPage(this.state.currentPage);
    this.scrollToActiveThumbnail(this.state.currentPage);
  }

  goLastPage() {
    const last = this.state.allPages.length;
    this.state.currentPage = this.normalizePage(last);
    this.scrollToPage(this.state.currentPage);
    this.scrollToActiveThumbnail(this.state.currentPage);
  }

  goPrevPage() {
    const p = this.normalizePage(this.state.currentPage - 1);
    this.state.currentPage = p;
    this.scrollToPage(p);
    this.scrollToActiveThumbnail(p);
  }

  goNextPage() {
    const p = this.normalizePage(this.state.currentPage + 1);
    this.state.currentPage = p;
    this.scrollToPage(p);
    this.scrollToActiveThumbnail(p);
  }

  onPageInput(event: Event) {
    const el = event.target as HTMLInputElement;
    let p = Number(el.value);

    if (!p || p < 1) p = 1;
    if (p > this.state.totalPages) p = this.state.totalPages;

    el.value = String(p);
    this.goToPage(p);
  }

  goToPage(page: number) {
    const p = this.normalizePage(page);
    this.state.currentPage = p;
    this.scrollToPage(p);
    this.scrollToActiveThumbnail(p);
  }

  onInputFocus(input: HTMLInputElement) {
    input.select();
  }

  scrollToActiveThumbnail(index: number, smooth: boolean = true) {
    console.log('smooth', smooth);
    const cont = this.thumbsContainerRef?.nativeElement;
    if (!cont) return;

    const el = cont.querySelector(`[data-index="${index}"]`);
    if (el) {
      el.scrollIntoView({
        behavior: smooth ? 'smooth' : 'auto',
      });
    }
  }

  ngAfterViewInit() {
    const container = this.pagesRef.nativeElement;
    container.addEventListener('scroll', this.onScroll);
  }

  onScroll = () => {
    this.detectCurrentPageOnScroll();
  };

  detectCurrentPageOnScroll() {
    const container = this.pagesRef?.nativeElement;
    if (!container) return;

    const imgs = Array.from(container.querySelectorAll<HTMLImageElement>('.page-img'));
    if (!imgs.length) return;

    let bestIndex = this.normalizePage(this.state.currentPage);
    let bestDist = Infinity;
    const viewportCenter = window.innerHeight / 2;

    for (const img of imgs) {
      const rect = img.getBoundingClientRect();
      const pageCenter = rect.top + rect.height / 2;
      const d = Math.abs(viewportCenter - pageCenter);

      const rawIdx = img.dataset['index'];
      const idx = Number(rawIdx);
      if (!Number.isFinite(idx)) continue;

      if (d < bestDist) {
        bestDist = d;
        bestIndex = idx;
      }
    }

    if (bestIndex !== this.state.currentPage) {
      this.state.currentPage = this.normalizePage(bestIndex);
      this.scrollToActiveThumbnail(this.state.currentPage);
    }
  }

  focusCurrentPage() {
    console.log('focusCurrentPage', );
    if (!this.state || !this.state.allPages.length) return;
    const p = this.normalizePage(this.state.currentPage);
    this.state.currentPage = p;
    this.scrollToPage(p, false);
    this.scrollToActiveThumbnail(p, false);
  }


  ngOnChanges() {
    if (!this.state) return;

    if (!this.state.allPages.length) return;

    if (this.state.allPages.length !== this.prevPageCount) {
      this.prevPageCount = this.state.allPages.length;

      queueMicrotask(() => {
        const p = this.normalizePage(this.state.currentPage);
        this.state.currentPage = p;
        this.scrollToPage(p, false);
        this.scrollToActiveThumbnail(p, false);
      });
    }

    if (this.state.currentPage !== this.prevTabCurrentPage) {
      this.prevTabCurrentPage = this.normalizePage(this.state.currentPage);

      queueMicrotask(() => {
        this.scrollToActiveThumbnail(this.state.currentPage);
      });
    }
  }

  ngOnDestroy() {
    const container = this.pagesRef?.nativeElement;
    if (container) {
      container.removeEventListener('scroll', this.onScroll);
    }
  }

  private normalizePage(page: number | null | undefined): number {
    let p = Number(page);

    if (!Number.isFinite(p) || p < 1) {
      p = 1;
    }

    const max = this.state?.totalPages || 1;
    if (p > max) p = max;

    return p;
  }

}
