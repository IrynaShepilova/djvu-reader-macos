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

interface SpreadPageLayout {
  page: PageMetadata;
  width: number;
  height: number;
  left: number;
  top: number;
}

interface SpreadLayout {
  key: number;
  rowWidth: number;
  rowHeight: number;
  leftPage?: SpreadPageLayout;
  rightPage?: SpreadPageLayout;
}

interface PageGeometry {
  top: number;
  height: number;
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
  spreadLayouts: SpreadLayout[] = [];
  renderedSinglePageLayouts: SinglePageLayout[] = [];
  renderedSpreadLayouts: SpreadLayout[] = [];
  topSpacerHeight = 0;
  bottomSpacerHeight = 0;
  private readonly spreadGap = 16;
  private readonly virtualOverscanViewports = 2;
  private viewportWidth = 0;
  private viewportHeight = 0;
  private rowGap = 0;
  private rowTops: number[] = [];
  private totalRowsHeight = 0;
  private pageRows = new Map<number, number>();
  private renderedRowStart = 0;
  private renderedRowEnd = 0;
  private viewportObserver?: ResizeObserver;
  private viewportFrame?: number;
  private virtualScrollFrame?: number;
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

    const target = this.getPageAnchorGeometry(index);
    if (!target) return;

    container.scrollTo({
      top: target.top,
      behavior: smooth ? 'smooth' : 'instant',
    });
    this.scheduleVirtualWindowUpdate();
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
    this.scheduleVirtualWindowUpdate();
    if (!this.suppressScrollDetect) {
      this.detectCurrentPageOnScroll();
    }
  };

  detectCurrentPageOnScroll() {
    if (!this.state.loadingDone) return;
    const container = this.pagesRef?.nativeElement;
    if (!container) return;

    const row = this.getClosestRow(
      container.scrollTop + container.clientHeight / 2
    );
    if (row === undefined) return;

    const bestIndex = this.getLogicalPageForRow(row);
    const page = this.getPageSlotGeometry(bestIndex);
    if (!page) return;

    const offsetRatio = Math.max(
      0,
      Math.min(1, (container.scrollTop - page.top) / page.height)
    );

    this.tabsService.saveReadingPosition(this.tabId, {
      page: bestIndex,
      offsetRatio,
    });

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
      !this.state?.pages?.length ||
      !this.viewportWidth ||
      !this.viewportHeight
    ) {
      this.singlePageLayouts = [];
      this.spreadLayouts = [];
      this.rebuildRowGeometry();
      return;
    }

    if (this.layoutMode === 'spread') {
      this.singlePageLayouts = [];
      this.spreadLayouts = this.createSpreadLayouts();
      this.rebuildRowGeometry();
      this.schedulePendingReadingRestore();
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
    this.spreadLayouts = [];

    this.rebuildRowGeometry();
    this.schedulePendingReadingRestore();
  }

  private rebuildRowGeometry() {
    const rows = this.layoutMode === 'single'
      ? this.singlePageLayouts
      : this.spreadLayouts;

    this.rowGap = this.getRowGap();
    this.rowTops = [];
    this.pageRows.clear();

    let top = 0;
    rows.forEach((row, index) => {
      this.rowTops.push(top);

      if (this.layoutMode === 'single') {
        this.pageRows.set((row as SinglePageLayout).page.index, index);
      } else {
        const spread = row as SpreadLayout;
        if (spread.leftPage) this.pageRows.set(spread.leftPage.page.index, index);
        if (spread.rightPage) this.pageRows.set(spread.rightPage.page.index, index);
      }

      top += row.rowHeight;
      if (index < rows.length - 1) top += this.rowGap;
    });

    this.totalRowsHeight = top;
    this.renderedRowStart = 0;
    this.renderedRowEnd = 0;
    this.updateVirtualWindow(true);
  }

  private getRowGap(): number {
    const container = this.pagesRef?.nativeElement;
    if (!container) return 0;

    const gap = Number.parseFloat(getComputedStyle(container).rowGap);
    return Number.isFinite(gap) ? gap : 0;
  }

  private scheduleVirtualWindowUpdate() {
    if (this.virtualScrollFrame !== undefined) return;

    const callbackVersion = this.callbackVersion;
    const tabId = this.tabId;
    this.virtualScrollFrame = requestAnimationFrame(() => {
      this.virtualScrollFrame = undefined;
      if (callbackVersion !== this.callbackVersion || tabId !== this.tabId) return;
      this.updateVirtualWindow();
    });
  }

  private updateVirtualWindow(force = false) {
    const rows = this.layoutMode === 'single'
      ? this.singlePageLayouts
      : this.spreadLayouts;
    const container = this.pagesRef?.nativeElement;

    if (!rows.length) {
      this.setRenderedRows(0, 0, force);
      return;
    }

    if (!container) {
      this.setRenderedRows(0, rows.length, force);
      return;
    }

    const overscan = container.clientHeight * this.virtualOverscanViewports;
    const start = this.findFirstVisibleRow(container.scrollTop - overscan);
    const end = this.findFirstRowAfter(
      container.scrollTop + container.clientHeight + overscan
    );

    this.setRenderedRows(start, Math.max(start + 1, end), force);
  }

  private setRenderedRows(start: number, end: number, force: boolean) {
    const rows = this.layoutMode === 'single'
      ? this.singlePageLayouts
      : this.spreadLayouts;
    const nextStart = Math.max(0, Math.min(start, rows.length));
    const nextEnd = Math.max(nextStart, Math.min(end, rows.length));

    if (!force && nextStart === this.renderedRowStart && nextEnd === this.renderedRowEnd) {
      return;
    }

    this.renderedRowStart = nextStart;
    this.renderedRowEnd = nextEnd;
    this.topSpacerHeight = nextStart > 0
      ? this.rowTops[nextStart] - this.rowGap
      : 0;
    this.bottomSpacerHeight = nextEnd < rows.length
      ? this.totalRowsHeight - this.getRowEnd(nextEnd - 1) - this.rowGap
      : 0;

    if (this.layoutMode === 'single') {
      this.renderedSinglePageLayouts = this.singlePageLayouts.slice(nextStart, nextEnd);
      this.renderedSpreadLayouts = [];
    } else {
      this.renderedSinglePageLayouts = [];
      this.renderedSpreadLayouts = this.spreadLayouts.slice(nextStart, nextEnd);
    }
  }

  private findFirstVisibleRow(position: number): number {
    return Math.max(0, this.findFirstRowAfter(position) - 1);
  }

  private findFirstRowAfter(position: number): number {
    let low = 0;
    let high = this.rowTops.length;

    while (low < high) {
      const middle = Math.floor((low + high) / 2);
      if (this.rowTops[middle] <= position) low = middle + 1;
      else high = middle;
    }

    return low;
  }

  private getRowEnd(row: number): number {
    const rows = this.layoutMode === 'single'
      ? this.singlePageLayouts
      : this.spreadLayouts;
    return this.rowTops[row] + rows[row].rowHeight;
  }

  private getClosestRow(position: number): number | undefined {
    if (!this.rowTops.length) return undefined;

    const next = this.findFirstRowCenterAfter(position);
    if (next === 0) return 0;
    if (next >= this.rowTops.length) return this.rowTops.length - 1;

    const previous = next - 1;
    return position - this.getRowCenter(previous) <= this.getRowCenter(next) - position
      ? previous
      : next;
  }

  private findFirstRowCenterAfter(position: number): number {
    let low = 0;
    let high = this.rowTops.length;

    while (low < high) {
      const middle = Math.floor((low + high) / 2);
      if (this.getRowCenter(middle) <= position) low = middle + 1;
      else high = middle;
    }

    return low;
  }

  private getRowCenter(row: number): number {
    const rows = this.layoutMode === 'single'
      ? this.singlePageLayouts
      : this.spreadLayouts;
    return this.rowTops[row] + rows[row].rowHeight / 2;
  }

  private getLogicalPageForRow(row: number): number {
    const current = this.normalizePage(this.state.currentPage);
    if (this.pageRows.get(current) === row) return current;

    if (this.layoutMode === 'single') {
      return this.singlePageLayouts[row].page.index;
    }

    const spread = this.spreadLayouts[row];
    return spread.leftPage?.page.index ?? spread.rightPage!.page.index;
  }

  private getPageAnchorGeometry(page: number): PageGeometry | undefined {
    const row = this.pageRows.get(page);
    if (row === undefined) return undefined;

    if (this.layoutMode === 'single') {
      return this.getPageSlotGeometry(page);
    }

    return {
      top: this.rowTops[row],
      height: this.spreadLayouts[row].rowHeight,
    };
  }

  private getPageSlotGeometry(page: number): PageGeometry | undefined {
    const row = this.pageRows.get(page);
    if (row === undefined) return undefined;

    if (this.layoutMode === 'single') {
      const layout = this.singlePageLayouts[row];
      return {
        top: this.rowTops[row] + layout.pageTop,
        height: layout.pageHeight,
      };
    }

    const spread = this.spreadLayouts[row];
    const layout = spread.leftPage?.page.index === page
      ? spread.leftPage
      : spread.rightPage?.page.index === page
        ? spread.rightPage
        : undefined;
    if (!layout) return undefined;

    return {
      top: this.rowTops[row] + layout.top,
      height: layout.height,
    };
  }

  private createSpreadLayouts(): SpreadLayout[] {
    const layouts: SpreadLayout[] = [];
    const pages = this.state.pages;

    for (let spreadIndex = 0; ; spreadIndex++) {
      const leftPage = spreadIndex === 0 ? undefined : pages[spreadIndex * 2 - 1];
      const rightPage = spreadIndex === 0 ? pages[0] : pages[spreadIndex * 2];
      if (!leftPage && !rightPage) break;

      const leftSize = leftPage ?? rightPage;
      const rightSize = rightPage ?? leftPage;

      if (!leftSize || !rightSize) continue;

      const intrinsicWidth = leftSize.width + this.spreadGap + rightSize.width;
      const intrinsicHeight = Math.max(leftSize.height, rightSize.height);
      let scale: number;

      if (this.fitMode === 'height') {
        scale = Math.min(
          this.viewportWidth / intrinsicWidth,
          this.viewportHeight / intrinsicHeight,
        );
      } else if (this.fitMode === 'width') {
        scale = this.viewportWidth / intrinsicWidth;
      } else {
        scale = Math.min(1, this.viewportWidth / intrinsicWidth);
      }

      const leftWidth = leftSize.width * scale * this.zoom;
      const leftHeight = leftSize.height * scale * this.zoom;
      const rightWidth = rightSize.width * scale * this.zoom;
      const rightHeight = rightSize.height * scale * this.zoom;
      const gap = this.spreadGap * scale * this.zoom;
      const spreadWidth = leftWidth + gap + rightWidth;
      const spreadHeight = Math.max(leftHeight, rightHeight);
      const rowWidth = Math.max(this.viewportWidth, spreadWidth);
      const rowHeight = this.fitMode === 'height'
        ? Math.max(this.viewportHeight, spreadHeight)
        : spreadHeight;
      const spreadLeft = (rowWidth - spreadWidth) / 2;
      const spreadTop = (rowHeight - spreadHeight) / 2;

      layouts.push({
        key: spreadIndex + 1,
        rowWidth,
        rowHeight,
        leftPage: leftPage ? {
          page: leftPage,
          width: leftWidth,
          height: leftHeight,
          left: spreadLeft,
          top: spreadTop + (spreadHeight - leftHeight) / 2,
        } : undefined,
        rightPage: rightPage ? {
          page: rightPage,
          width: rightWidth,
          height: rightHeight,
          left: spreadLeft + leftWidth + gap,
          top: spreadTop + (spreadHeight - rightHeight) / 2,
        } : undefined,
      });
    }

    return layouts;
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

    const anchor = this.getPageAnchorGeometry(page);

    if (anchor) {
      container.scrollTo({
        top: anchor.top + anchor.height * position.offsetRatio,
        behavior: 'instant',
      });
    }
    this.scheduleVirtualWindowUpdate();

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
      const anchor = this.getPageAnchorGeometry(pending.position.page);

      if (!container || !anchor) {
        if (!this.hasCurrentLayoutSlots()) {
          this.scheduleViewportMeasurement();
          return;
        }

        this.pendingReadingRestore = undefined;
        this.suppressScrollDetect = false;
        return;
      }

      this.pendingReadingRestore = undefined;
      void this.applyReadingPosition(container, pending, callbackVersion, tabId);
    });
  }

  private async applyReadingPosition(
    container: HTMLElement,
    pending: { position: ReadingPosition; smooth: boolean },
    callbackVersion: number,
    tabId: string,
  ) {
    const { page, offsetRatio } = pending.position;
    this.state.currentPage = page;

    const anchor = this.getPageAnchorGeometry(page);
    if (!anchor) {
      this.suppressScrollDetect = false;
      return;
    }
    const targetScrollTop = anchor.top + anchor.height * offsetRatio;

    this.scrollToActiveThumbnail(page, pending.smooth);

    if (pending.smooth) {
      await this.smoothScrollTo(container, targetScrollTop, 180, callbackVersion, tabId);
      if (callbackVersion === this.callbackVersion && tabId === this.tabId) {
        this.suppressScrollDetect = false;
      }
      return;
    }

    container.scrollTo({ top: targetScrollTop, behavior: 'instant' });
    this.scheduleVirtualWindowUpdate();
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

  private hasCurrentLayoutSlots(): boolean {
    return this.layoutMode === 'single'
      ? this.singlePageLayouts.length > 0
      : this.spreadLayouts.length > 0;
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
    if (this.virtualScrollFrame !== undefined) {
      cancelAnimationFrame(this.virtualScrollFrame);
      this.virtualScrollFrame = undefined;
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
