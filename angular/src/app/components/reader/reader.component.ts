import {
  AfterViewInit,
  afterNextRender, AfterRenderRef, ChangeDetectionStrategy, Component, ElementRef, Injector,
  Input, OnChanges, OnDestroy, OnInit, SimpleChanges, ViewChild,
} from '@angular/core';
import { environment } from '../../../environments/environment';
import {ReaderFitMode, ReaderLayoutMode, ReadingPosition, TabState} from '../../interfaces/tabState';
import { TabsService } from '../../services/tabs.service';
import {DecimalPipe} from '@angular/common';
import {Subscription} from 'rxjs';
type PageMetadata = TabState['pages'][number];

interface SinglePageLayout {
  page: PageMetadata;
  rowWidth: number;
  rowHeight: number;
  pageWidth: number;
  pageHeight: number;
  pageLeft: number;
  pageTop: number;
}

@Component({
  selector: 'app-reader',
  standalone: true,
  imports: [
    DecimalPipe
  ],
  templateUrl: './reader.component.html',
  changeDetection: ChangeDetectionStrategy.Eager,
  styleUrl: './reader.component.scss',
})
export class ReaderComponent implements OnInit, AfterViewInit, OnChanges, OnDestroy {

  constructor(
    private tabsService: TabsService,
    private injector: Injector,
  ) {
  }

  @ViewChild('pagesContainer') pagesRef!: ElementRef<HTMLDivElement>;
  @ViewChild('thumbsContainer') thumbsContainerRef!: ElementRef<HTMLDivElement>;
  @Input() state!: TabState;
  @Input() tabId!: string;

  private readonly apiBase = environment.apiBase;
  private prevPageCount = 0;
  private prevTabCurrentPage = 0;
  stateSub?: Subscription;
  suppressScrollDetect = false;

  singlePageLayouts: SinglePageLayout[] = [];
  private viewportWidth = 0;
  private viewportHeight = 0;
  private viewportObserver?: ResizeObserver;
  private viewportFrame?: number;
  private layoutAnchorRenderRef?: AfterRenderRef;
  private pendingLayoutAnchor?: ReadingPosition;
  private pendingReadingRestore?: { position: ReadingPosition; smooth: boolean };
  private readingRestoreFrame?: number;
  private callbackVersion = 0;

  readonly zoomStep = 0.1;
  readonly zoomMin = 0.3;
  readonly zoomMax = 3;

  get layoutMode(): ReaderLayoutMode {
    return this.state?.layoutMode ?? 'single';
  }

  get fitMode(): ReaderFitMode {
    return this.state?.fitMode ?? 'none';
  }

  get zoom(): number {
    return this.state?.zoom ?? 1;
  }

  async ngOnInit() {
  }


  onThumbClick(index: number) {
    void this.goToPage(index);
  }

  getLoadedPage(index: number) {
    return this.state.allPages.find(page => page.index === index);
  }

  scrollToPage(index: number, smooth = true) {
    const container = this.pagesRef?.nativeElement;
    if (!container) return;

    const el = container.querySelector<HTMLElement>(
      `[data-index="${index}"]`
    );
    if (!el) return;

    const contRect = container.getBoundingClientRect();
    const elRect = el.getBoundingClientRect();

    const targetScrollTop =
      container.scrollTop + (elRect.top - contRect.top);

    container.scrollTo({
      top: targetScrollTop,
      behavior: smooth ? 'smooth' : 'instant',
    });
  }

  async goToPage(page: number, addToHistory = true) {
    const p = this.normalizePage(page);

    if (addToHistory) {
      const from =
        this.tabsService.getSavedReadingPosition(this.tabId) ?? {
          page: this.state.currentPage,
          offsetRatio: 0,
        };

      const to: ReadingPosition = {
        page: p,
        offsetRatio: 0,
      };

      this.tabsService.navigateInHistory(
        this.tabId,
        from,
        to
      );
    }

    this.state.currentPage = p;
    this.saveCurrentPage();

    void this.tabsService.ensureThumbnailLoaded(this.tabId, p);

    this.scrollToPage(p);
    this.scrollToActiveThumbnail(p);

    void this.tabsService.ensurePageWindowLoaded(
      this.tabId,
      p,
      1
    );
  }

  goFirstPage() {
    void this.goToPage(1);
  }

  goLastPage() {
    void this.goToPage(this.state.totalPages);
  }

  goPrevPage() {
    void this.goToPage(this.state.currentPage - 1);
  }

  goNextPage() {
    void this.goToPage(this.state.currentPage + 1);
  }

  async onPageInput(event: Event) {
    const el = event.target as HTMLInputElement;
    let p = Number(el.value);

    if (!p || p < 1) p = 1;
    if (p > this.state.totalPages) p = this.state.totalPages;

    el.value = String(p);
    await this.goToPage(p);
  }

  onInputFocus(input: HTMLInputElement) {
    input.select();
  }

  scrollToActiveThumbnail(index: number, smooth: boolean = true) {
    const cont = this.thumbsContainerRef?.nativeElement;
    if (!cont) return;

    const el = cont.querySelector(`[data-index="${index}"]`);
    if (el) {
      const contRect = cont.getBoundingClientRect();
      const elRect = el.getBoundingClientRect();
      const targetScrollTop = cont.scrollTop + (elRect.top - contRect.top);
      cont.scrollTo({
        top: targetScrollTop,
        behavior: smooth ? 'smooth' : 'auto',
      });
    }
  }

  ngAfterViewInit() {
    const container = this.pagesRef.nativeElement;
    container.addEventListener('scroll', this.onScroll);

    this.viewportObserver = new ResizeObserver(() => {
      this.scheduleViewportMeasurement();
    });
    this.viewportObserver.observe(container);
    this.scheduleViewportMeasurement();
  }

  onScroll = () => {
    if (this.suppressScrollDetect) return;
    this.detectCurrentPageOnScroll();
  };

  detectCurrentPageOnScroll() {
    if (!this.state.loadingDone) return;
    const container = this.pagesRef?.nativeElement;
    if (!container) return;

    const pages = Array.from(container.querySelectorAll<HTMLElement>('.page-slot'));
    if (!pages.length) return;

    const contRect = container.getBoundingClientRect();
    const viewportCenter = contRect.top + contRect.height / 2;

    let bestIndex = this.normalizePage(this.state.currentPage);
    let bestDist = Infinity;
    let bestPage: HTMLElement | null = null;

    for (const page of pages) {
      const rect = page.getBoundingClientRect();
      const pageCenter = rect.top + rect.height / 2;
      const d = Math.abs(viewportCenter - pageCenter);

      const idx = Number(page.dataset['index']);
      if (!Number.isFinite(idx)) continue;

      if (d < bestDist) {
        bestDist = d;
        bestIndex = idx;
        bestPage = page;
      }
    }

    if (bestPage) {
      const contRect = container.getBoundingClientRect();
      const pageRect = bestPage.getBoundingClientRect();

      const offset = contRect.top - pageRect.top;

      const offsetRatio = Math.max(
        0,
        Math.min(1, offset / pageRect.height)
      );

      this.tabsService.saveReadingPosition(
        this.tabId,
        {
          page: bestIndex,
          offsetRatio,
        }
      );
    }

    if (bestIndex !== this.state.currentPage) {
      this.state.currentPage = this.normalizePage(bestIndex);
      this.saveCurrentPage();
      this.scrollToActiveThumbnail(this.state.currentPage);
    }
  }

  focusCurrentPage() {
    if (!this.state || !this.state.pages.length) return;

    void this.restoreReadingPosition(0, false);
  }


  ngOnChanges(changes: SimpleChanges): void  {
    if (changes['tabId']) {
      this.cancelPendingLayoutCallbacks();
      this.prevPageCount = 0;
      this.prevTabCurrentPage = 0;
      this.suppressScrollDetect = true;
      this.stateSub?.unsubscribe();

      this.stateSub = this.tabsService
        .getState$(this.tabId)
        .subscribe(state => {
          this.updateState(state);
        });
      return;
    }

    if (!this.state) return;

    this.updateState(this.state);
  }

  ngOnDestroy() {
    this.stateSub?.unsubscribe();
    this.viewportObserver?.disconnect();

    this.cancelPendingLayoutCallbacks();

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

  private saveCurrentPage() {
    this.tabsService.saveCurrentPage(this.tabId, this.state.currentPage);
  }

  setLayout(mode: ReaderLayoutMode) {
    if (mode === this.layoutMode) return;

    this.changeLayout(() => {
      this.tabsService.updateReaderDisplay(this.tabId, { layoutMode: mode });
    });
  }

  setFit(mode: ReaderFitMode) {
    if (mode === this.fitMode) return;

    this.changeLayout(() => {
      this.tabsService.updateReaderDisplay(this.tabId, { fitMode: mode });
    });
  }

  zoomIn() {
    const zoom = Math.min(this.zoomMax, Math.round((this.zoom + this.zoomStep) * 10) / 10);
    if (zoom === this.zoom) return;

    this.changeLayout(() => {
      this.tabsService.updateReaderDisplay(this.tabId, { zoom });
    });
  }

  zoomOut() {
    const zoom = Math.max(this.zoomMin, Math.round((this.zoom - this.zoomStep) * 10) / 10);
    if (zoom === this.zoom) return;

    this.changeLayout(() => {
      this.tabsService.updateReaderDisplay(this.tabId, { zoom });
    });
  }

  resetZoom() {
    if (this.zoom === 1) return;

    this.changeLayout(() => {
      this.tabsService.updateReaderDisplay(this.tabId, { zoom: 1 });
    });
  }

  private updateState(state: TabState) {
    this.state = state;
    this.rebuildSinglePageLayouts();
    this.handleStateUpdate();
  }

  private scheduleViewportMeasurement() {
    if (this.viewportFrame !== undefined) return;

    const callbackVersion = this.callbackVersion;
    this.viewportFrame = requestAnimationFrame(() => {
      this.viewportFrame = undefined;
      if (callbackVersion !== this.callbackVersion) return;

      const container = this.pagesRef?.nativeElement;
      if (!container) return;

      const width = container.clientWidth;
      const height = container.clientHeight;

      if (width === this.viewportWidth && height === this.viewportHeight) return;

      this.viewportWidth = width;
      this.viewportHeight = height;
      this.rebuildSinglePageLayouts();

      if (this.pendingLayoutAnchor) {
        this.scheduleLayoutAnchor(this.pendingLayoutAnchor);
      }
    });
  }

  private rebuildSinglePageLayouts() {
    if (
      this.layoutMode !== 'single' ||
      !this.state?.pages?.length ||
      !this.viewportWidth ||
      !this.viewportHeight
    ) {
      this.singlePageLayouts = [];
      return;
    }

    this.singlePageLayouts = this.state.pages.map(page => {
      const aspectRatio = page.width / page.height;
      let baseWidth: number;
      let baseHeight: number;

      if (this.fitMode === 'height') {
        const scale = Math.min(
          this.viewportWidth / page.width,
          this.viewportHeight / page.height,
        );
        baseWidth = page.width * scale;
        baseHeight = page.height * scale;
      } else if (this.fitMode === 'width') {
        baseWidth = this.viewportWidth;
        baseHeight = baseWidth / aspectRatio;
      } else {
        baseWidth = Math.min(page.width, this.viewportWidth);
        baseHeight = baseWidth / aspectRatio;
      }

      const pageWidth = baseWidth * this.zoom;
      const pageHeight = baseHeight * this.zoom;
      const rowWidth = Math.max(this.viewportWidth, pageWidth);
      const rowHeight = this.fitMode === 'height'
        ? Math.max(this.viewportHeight, pageHeight)
        : pageHeight;

      return {
        page,
        rowWidth,
        rowHeight,
        pageWidth,
        pageHeight,
        pageLeft: (rowWidth - pageWidth) / 2,
        pageTop: (rowHeight - pageHeight) / 2,
      };
    });

    this.schedulePendingReadingRestore();
  }

  private handleStateUpdate() {
    if (!this.state.pages.length) return;

    const callbackVersion = this.callbackVersion;
    const tabId = this.tabId;

    if (this.state.pages.length !== this.prevPageCount) {
      this.prevPageCount = this.state.pages.length;

      queueMicrotask(() => {
        if (callbackVersion !== this.callbackVersion || tabId !== this.tabId) return;

        const p = this.normalizePage(this.state.currentPage);
        this.state.currentPage = p;
        this.scrollToPage(p, false);
        this.scrollToActiveThumbnail(p, false);
      });
    }

    if (this.state.currentPage !== this.prevTabCurrentPage) {
      this.prevTabCurrentPage = this.normalizePage(this.state.currentPage);

      queueMicrotask(() => {
        if (callbackVersion !== this.callbackVersion || tabId !== this.tabId) return;
        this.scrollToActiveThumbnail(this.state.currentPage);
      });
    }
  }

  private changeLayout(change: () => void) {
    const page = this.normalizePage(this.state.currentPage);
    const savedPosition = this.tabsService.getSavedReadingPosition(this.tabId);
    const position: ReadingPosition = {
      page,
      offsetRatio: savedPosition?.page === page
        ? savedPosition.offsetRatio
        : 0,
    };

    this.suppressScrollDetect = true;
    this.pendingLayoutAnchor = position;
    change();
    this.rebuildSinglePageLayouts();
    this.scheduleLayoutAnchor(position);
  }

  private scheduleLayoutAnchor(position: ReadingPosition) {
    if (this.layoutAnchorRenderRef) {
      this.layoutAnchorRenderRef.destroy();
      this.layoutAnchorRenderRef = undefined;
    }

    const callbackVersion = this.callbackVersion;
    const tabId = this.tabId;
    this.layoutAnchorRenderRef = afterNextRender(() => {
      this.layoutAnchorRenderRef = undefined;
      if (callbackVersion !== this.callbackVersion || tabId !== this.tabId) return;
      this.restoreLayoutAnchor(position);
    }, { injector: this.injector });
  }

  private restoreLayoutAnchor(position: ReadingPosition) {
    const container = this.pagesRef?.nativeElement;
    const page = this.normalizePage(this.state.currentPage);

    if (!container) {
      this.suppressScrollDetect = false;
      return;
    }

    const element = container.querySelector<HTMLElement>(`[data-index="${page}"]`);

    if (element) {
      const containerRect = container.getBoundingClientRect();
      const pageRect = element.getBoundingClientRect();
      const pageTop = container.scrollTop + (pageRect.top - containerRect.top);

      container.scrollTo({
        top: pageTop + pageRect.height * position.offsetRatio,
        behavior: 'instant',
      });
    }
    requestAnimationFrame(() => {
      const rect = element?.getBoundingClientRect();
      const containerRect = container.getBoundingClientRect();
    });

    this.scrollToActiveThumbnail(page, false);
    this.tabsService.saveReadingPosition(this.tabId, {
      page,
      offsetRatio: position.offsetRatio,
    });

    const callbackVersion = this.callbackVersion;
    const tabId = this.tabId;
    requestAnimationFrame(() => {
      if (
        callbackVersion !== this.callbackVersion ||
        tabId !== this.tabId ||
        this.layoutAnchorRenderRef !== undefined
      ) return;

      this.pendingLayoutAnchor = undefined;
      this.suppressScrollDetect = false;
    });
  }

  get readerBusy(): boolean {
    return !this.state.loadingDone || this.suppressScrollDetect;
  }

  async restoreReadingPosition(offsetRatio: number, smooth = false) {
    if (!this.state || !this.state.pages.length) {
      this.suppressScrollDetect = false;
      return;
    }

    this.suppressScrollDetect = true;
    this.pendingReadingRestore = {
      position: {
        page: this.normalizePage(this.state.currentPage),
        offsetRatio: Math.max(0, Math.min(1, offsetRatio)),
      },
      smooth,
    };
    this.schedulePendingReadingRestore();
  }

  private schedulePendingReadingRestore() {
    if (!this.pendingReadingRestore || this.readingRestoreFrame !== undefined) return;

    const callbackVersion = this.callbackVersion;
    const tabId = this.tabId;
    this.readingRestoreFrame = requestAnimationFrame(() => {
      this.readingRestoreFrame = undefined;
      if (callbackVersion !== this.callbackVersion || tabId !== this.tabId) return;

      const pending = this.pendingReadingRestore;
      if (!pending) return;

      const container = this.pagesRef?.nativeElement;
      const element = container?.querySelector<HTMLElement>(
        `[data-index="${pending.position.page}"]`
      );

      if (!container || !element) {
        if (this.layoutMode === 'single' && !this.singlePageLayouts.length) {
          this.scheduleViewportMeasurement();
          return;
        }

        this.pendingReadingRestore = undefined;
        this.suppressScrollDetect = false;
        return;
      }

      this.pendingReadingRestore = undefined;
      void this.applyReadingPosition(container, element, pending, callbackVersion, tabId);
    });
  }

  private async applyReadingPosition(
    container: HTMLElement,
    element: HTMLElement,
    pending: { position: ReadingPosition; smooth: boolean },
    callbackVersion: number,
    tabId: string,
  ) {
    const { page, offsetRatio } = pending.position;
    this.state.currentPage = page;

    const contRect = container.getBoundingClientRect();
    const pageRect = element.getBoundingClientRect();
    const pageTop = container.scrollTop + (pageRect.top - contRect.top);
    const targetScrollTop = pageTop + pageRect.height * offsetRatio;

    this.scrollToActiveThumbnail(page, pending.smooth);

    if (pending.smooth) {
      await this.smoothScrollTo(container, targetScrollTop, 180, callbackVersion, tabId);
      if (callbackVersion === this.callbackVersion && tabId === this.tabId) {
        this.suppressScrollDetect = false;
      }
      return;
    }

    container.scrollTo({ top: targetScrollTop, behavior: 'instant' });
    this.releaseScrollDetection(callbackVersion, tabId);
  }

  private releaseScrollDetection(callbackVersion = this.callbackVersion, tabId = this.tabId) {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        if (callbackVersion !== this.callbackVersion || tabId !== this.tabId) return;
        this.suppressScrollDetect = false;
      });
    });
  }

  private async goToPosition(position: ReadingPosition, smooth = true) {
    await this.goToPage(position.page, false);

    this.tabsService.saveReadingPosition(
      this.tabId,
      position
    );

    await this.restoreReadingPosition(position.offsetRatio, smooth);
  }

  async goBackHistory() {
    this.updateCurrentHistoryPosition();

    const position =
      this.tabsService.goBackInHistory(this.tabId);

    if (!position) return;

    await this.goToPosition(position);
  }

  async goForwardHistory() {
    this.updateCurrentHistoryPosition();

    const position =
      this.tabsService.goForwardInHistory(this.tabId);

    if (!position) return;

    await this.goToPosition(position);
  }

  get canGoBackHistory(): boolean {
    return this.tabsService.canGoBack(this.tabId);
  }

  get canGoForwardHistory(): boolean {
    return this.tabsService.canGoForward(this.tabId);
  }

  get backHistoryTitle(): string {
    const position = this.tabsService.getBackHistoryPosition(this.tabId);

    return position
      ? `Back to page ${position.page}`
      : 'Back';
  }

  get forwardHistoryTitle(): string {
    const position = this.tabsService.getForwardHistoryPosition(this.tabId);

    return position
      ? `Forward to page ${position.page}`
      : 'Forward';
  }

  private updateCurrentHistoryPosition() {
    const position = this.tabsService.getSavedReadingPosition(this.tabId);

    if (!position) return;

    this.tabsService.updateCurrentHistoryPosition(this.tabId, position);
  }

  private cancelPendingLayoutCallbacks() {
    this.callbackVersion++;

    if (this.viewportFrame !== undefined) {
      cancelAnimationFrame(this.viewportFrame);
      this.viewportFrame = undefined;
    }
    if (this.layoutAnchorRenderRef) {
      this.layoutAnchorRenderRef.destroy();
      this.layoutAnchorRenderRef = undefined;
    }
    if (this.readingRestoreFrame !== undefined) {
      cancelAnimationFrame(this.readingRestoreFrame);
      this.readingRestoreFrame = undefined;
    }

    this.pendingLayoutAnchor = undefined;
    this.pendingReadingRestore = undefined;
  }

  private smoothScrollTo(
    container: HTMLElement,
    target: number,
    duration = 180,
    callbackVersion = this.callbackVersion,
    tabId = this.tabId,
  ): Promise<void> {
    const start = container.scrollTop;
    const distance = target - start;
    const startedAt = performance.now();

    return new Promise(resolve => {
      const step = (now: number) => {
        if (callbackVersion !== this.callbackVersion || tabId !== this.tabId) {
          resolve();
          return;
        }

        const elapsed = now - startedAt;
        const progress = Math.min(elapsed / duration, 1);

        const eased =
          1 - Math.pow(1 - progress, 3);

        container.scrollTop =
          start + distance * eased;

        if (progress < 1) {
          requestAnimationFrame(step);
        } else {
          resolve();
        }
      };

      requestAnimationFrame(step);
    });
  }

}
