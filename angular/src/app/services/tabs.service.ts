import { Injectable } from '@angular/core';
import {BehaviorSubject} from 'rxjs';
import { Tab } from '../interfaces/tab';
import { Book } from '../interfaces/book';
import {ReadingPosition, TabState} from '../interfaces/tabState';
import {environment} from '../../environments/environment';
import { Router } from '@angular/router';
import { ReadingHistory } from '../classes/reading-history';
import { DocumentService } from './document.service';

interface PageRenderRequest {
  page: number;
  resolve: (loaded: boolean) => void;
  promise: Promise<boolean>;
}

interface PageCacheController {
  desiredPages: Set<number>;
  pinnedPages: Set<number>;
  queue: PageRenderRequest[];
  pending: Map<number, PageRenderRequest>;
  processing: boolean;
  generation: number;
  pruneTimer?: number;
}

interface ThumbnailRenderRequest {
  page: number;
  resolve: (loaded: boolean) => void;
  promise: Promise<boolean>;
}

interface ThumbnailCacheController {
  desiredPages: Set<number>;
  pinnedPages: Set<number>;
  queue: ThumbnailRenderRequest[];
  pending: Map<number, ThumbnailRenderRequest>;
  processing: boolean;
  generation: number;
  pruneTimer?: number;
}

@Injectable({ providedIn: 'root' })
export class TabsService {

  constructor(
    private router: Router,
    private documents: DocumentService,
  ) {
    this.restoreTabs();
  }

  private tabsSubject = new BehaviorSubject<Tab[]>([]);
  tabs$ = this.tabsSubject.asObservable();

  private activeTabIdSubject = new BehaviorSubject<string | null>(null);
  activeTabId$ = this.activeTabIdSubject.asObservable();

  private tabStates = new Map<string, TabState>();
  private tabStateSubjects = new Map<
    string,
    BehaviorSubject<TabState>
  >();

  private readonly LS_TABS = 'djvu.tabs.v1';
  private readonly LS_ACTIVE = 'djvu.activeTabId.v1';
  private readonly LS_PAGE_PREFIX = 'djvu.lastPageByBookUrl.v1:'; // key = prefix + book.url
  private readonly LS_READING_POSITION_PREFIX = 'djvu.positionByBookUrl.v1:';

  private readonly pageCacheControllers = new Map<string, PageCacheController>();
  private readonly thumbnailCacheControllers = new Map<string, ThumbnailCacheController>();

  private tabHistories = new Map<string, ReadingHistory>();

  get tabs(): Tab[] {
    return this.tabsSubject.value;
  }

  get activeTabId(): string | null {
    return this.activeTabIdSubject.value;
  }

  openBook(book: Book): string {
    const existing = this.tabs.find(t => t.book.url === book.url);
    if (existing) {
      if (this.activeTabId !== existing.id) {
        this.pausePageCache(this.activeTabId);
        this.pauseThumbnailCache(this.activeTabId);
      }
      this.activeTabIdSubject.next(existing.id);
      this.markBookOpened(existing.book);
      return existing.id;
    }

    const id = crypto.randomUUID();
    const newTab: Tab = {
      id,
      title: book.title,
      book: { ...book },
    };

    this.tabStates.set(id, this.createEmptyState(id, book.url));
    this.tabsSubject.next([...this.tabs, newTab]);
    this.pausePageCache(this.activeTabId);
    this.pauseThumbnailCache(this.activeTabId);
    this.activeTabIdSubject.next(id);

    this.markBookOpened(newTab.book);

    return id;
  }

  closeTab(id: string) {
    this.invalidatePageCache(id);
    this.invalidateThumbnailCache(id);
    const st = this.tabStates.get(id);
    if (st) {
      this.revokeStateUrls(st);
      void st.document?.destroy();
      st.document = undefined;

      st.allPages = [];
      st.pages = [];
      st.thumbs = [];
    }

    const remaining = this.tabs.filter(t => t.id !== id);
    this.tabsSubject.next(remaining);

    this.tabStates.delete(id);
    this.tabStateSubjects.delete(id);

    if (this.activeTabId === id) {
      const next = remaining[remaining.length - 1] || null;
      this.activeTabIdSubject.next(next ? next.id : null);
    }

    this.persistTabs();
  }


  setActive(id: string) {
    const tab = this.tabs.find(t => t.id === id);
    if (!tab) return;

    if (this.activeTabId !== id) {
      this.pausePageCache(this.activeTabId);
      this.pauseThumbnailCache(this.activeTabId);
      this.activeTabIdSubject.next(id);
    }
    this.markBookOpened(tab.book);
  }

  private touchActiveBook(tabId: string | null) {
    if (!tabId) return;

    const tab = this.tabs.find(t => t.id === tabId);
    if (!tab) return;

    const nowIso = new Date().toISOString();

    tab.book.lastOpenedAt = nowIso;
    this.persistTabs();

    void this.saveBookMetaToBackend(tab.book.id, { lastOpenedAt: nowIso });
  }

  async loadBook(tabId: string, forceReload = false): Promise<void> {
    const tab = this.tabs.find(t => t.id === tabId);
    if (!tab) return;

    const state = this.ensureTabState(tabId);
    if (!state) return;

    if (state.loading) return;

    if (!forceReload && state.pages.length > 0 && state.document) return;

    state.loading = true;
    state.loadingProgress = 0;
    this.emitState(tabId);
    state.loadingDone = false;

    if (forceReload) {
      this.invalidatePageCache(tabId);
      this.invalidateThumbnailCache(tabId);
      this.revokeStateUrls(state);
      const document = state.document;
      state.document = undefined;
      await document?.destroy();
      state.allPages = [];
      state.pages = [];
      state.thumbs = [];
      state.totalPages = 0;
    }

    try {
      const fileUrl = `${environment.apiBase}${tab.book.url}`;
      const doc = await this.documents.load(tab.book, fileUrl);
      state.document = doc;
      state.totalPages = doc.pageCount;
      state.thumbs = Array.from(
        { length: state.totalPages },
        (_, index) => ({ index: index + 1, url: null }),
      );

      await this.saveTotalPagesToBackend(tab.book.id, state.totalPages);

      state.currentPage = Math.max(1, Math.min(state.currentPage || 1, state.totalPages));

      await this.loadPageDimensions(tabId);
      this.emitState(tabId);

      await this.loadInitialPages(tabId);
      await this.loadInitialThumbnails(tabId);

      state.loadingDone = true;
      this.emitState(tabId);

    } catch (err) {
      console.error('Book load failed:', err);
      throw err;
    } finally {
      state.loading = false;
    }
  }

  private revokeStateUrls(state: TabState) {
    for (const p of state.allPages ?? []) {
      try { URL.revokeObjectURL(p.url); } catch {}
    }
    for (const t of state.thumbs ?? []) {
      if (t.url) {
        try { URL.revokeObjectURL(t.url); } catch {}
      }
    }
  }


  private async loadInitialPages(tabId: string): Promise<void> {
    const state = this.tabStates.get(tabId);
    if (!state) return;

    const current = Math.max(1, Math.min(state.currentPage || 1, state.totalPages));
    await this.loadPagesByIndexes(tabId, [current], true);
  }

  private async loadPageDimensions(tabId: string): Promise<void> {
    const state = this.tabStates.get(tabId);
    if (!state || !state.document) return;

    const document = state.document;
    const pages: { index: number; width: number; height: number }[] = [];

    for (let page = 1; page <= state.totalPages; page++) {
      if (this.tabStates.get(tabId)?.document !== document) return;

      const dimensions = await document.getPageDimensions(page);

      if (this.tabStates.get(tabId)?.document !== document) return;

      pages.push({
        index: page,
        width: dimensions.width,
        height: dimensions.height,
      });
    }

    state.pages = pages;
  }

  private async loadInitialThumbnails(tabId: string): Promise<void> {
    const state = this.tabStates.get(tabId);
    if (!state) return;

    const current = Math.max(1, Math.min(state.currentPage || 1, state.totalPages));
    await this.requestThumbnails(tabId, [current], true);
  }

  private async loadPagesByIndexes(
    tabId: string,
    indexes: number[],
    pinPages = false,
  ): Promise<void> {
    await this.requestPages(tabId, indexes, pinPages);
  }

  updatePageCacheWindow(tabId: string, pageIndexes: number[]): void {
    const state = this.tabStates.get(tabId);
    if (!state || !state.document) return;

    const controller = this.getPageCacheController(tabId);
    controller.desiredPages = new Set(
      this.normalizePageIndexes(state, pageIndexes),
    );

    if (this.containsAll(controller.desiredPages, controller.pinnedPages)) {
      controller.pinnedPages.clear();
    }

    this.schedulePageCachePrune(tabId);
    void this.requestPages(tabId, [...controller.desiredPages]);
  }

  async ensurePagesLoaded(tabId: string, pageIndexes: number[]): Promise<void> {
    await this.requestPages(tabId, pageIndexes, true);
  }

  private getPageCacheController(tabId: string): PageCacheController {
    let controller = this.pageCacheControllers.get(tabId);

    if (!controller) {
      controller = {
        desiredPages: new Set<number>(),
        pinnedPages: new Set<number>(),
        queue: [],
        pending: new Map<number, PageRenderRequest>(),
        processing: false,
        generation: 0,
      };
      this.pageCacheControllers.set(tabId, controller);
    }

    return controller;
  }

  private async requestPages(
    tabId: string,
    pageIndexes: number[],
    pinPages = false,
  ): Promise<boolean[]> {
    const state = this.tabStates.get(tabId);
    if (!state || !state.document || this.activeTabId !== tabId) return [];

    const controller = this.getPageCacheController(tabId);
    const indexes = this.normalizePageIndexes(state, pageIndexes);

    if (pinPages) {
      controller.pinnedPages = new Set(indexes);
      this.schedulePageCachePrune(tabId);
    }

    const requests = indexes.map(page => this.enqueuePageRender(tabId, page));
    this.startPageRenderQueue(tabId);

    return Promise.all(requests);
  }

  private enqueuePageRender(tabId: string, page: number): Promise<boolean> {
    const state = this.tabStates.get(tabId);
    if (!state || state.allPages.some(entry => entry.index === page)) {
      return Promise.resolve(true);
    }

    const controller = this.getPageCacheController(tabId);
    const pending = controller.pending.get(page);
    if (pending) return pending.promise;

    let resolve!: (loaded: boolean) => void;
    const promise = new Promise<boolean>(done => {
      resolve = done;
    });
    const request: PageRenderRequest = { page, resolve, promise };

    controller.pending.set(page, request);
    controller.queue.unshift(request);
    return promise;
  }

  private startPageRenderQueue(tabId: string): void {
    const controller = this.getPageCacheController(tabId);
    if (controller.processing) return;

    controller.processing = true;
    void this.processPageRenderQueue(tabId, controller);
  }

  private async processPageRenderQueue(
    tabId: string,
    controller: PageCacheController,
  ): Promise<void> {
    try {
      while (controller.queue.length) {
        const request = controller.queue.shift()!;
        const generation = controller.generation;
        const state = this.tabStates.get(tabId);
        const document = state?.document;

        if (
          !state ||
          !document ||
          this.activeTabId !== tabId ||
          !this.isPageWanted(controller, request.page)
        ) {
          if (controller.pending.get(request.page) === request) {
            controller.pending.delete(request.page);
          }
          request.resolve(false);
          continue;
        }

        try {
          const rendered = await document.renderPage(request.page);
          const currentState = this.tabStates.get(tabId);

          if (
            currentState !== state ||
            currentState.document !== document ||
            controller.generation !== generation ||
            this.activeTabId !== tabId ||
            !this.isPageWanted(controller, request.page)
          ) {
            request.resolve(false);
            continue;
          }

          if (currentState.allPages.some(entry => entry.index === request.page)) {
            request.resolve(true);
            continue;
          }

          const url = URL.createObjectURL(rendered.blob);
          if (!this.isPageWanted(controller, request.page)) {
            URL.revokeObjectURL(url);
            request.resolve(false);
            continue;
          }

          currentState.allPages.push({
            index: request.page,
            url,
            width: rendered.width,
            height: rendered.height,
          });
          currentState.allPages.sort((a, b) => a.index - b.index);
          currentState.loadingProgress = Math.round(
            (currentState.allPages.length / currentState.totalPages) * 100,
          );
          this.emitState(tabId);
          request.resolve(true);
        } catch (err) {
          if (controller.generation === generation) {
            console.warn(`Error loading page ${request.page}:`, err);
          }
          request.resolve(false);
        } finally {
          if (controller.pending.get(request.page) === request) {
            controller.pending.delete(request.page);
          }
        }
      }
    } finally {
      controller.processing = false;
      if (controller.queue.length) {
        this.startPageRenderQueue(tabId);
      }
    }
  }

  private normalizePageIndexes(state: TabState, pageIndexes: number[]): number[] {
    const indexes = new Set<number>();

    for (const page of pageIndexes) {
      const normalized = Math.max(1, Math.min(Math.floor(page), state.totalPages));
      if (Number.isFinite(normalized)) indexes.add(normalized);
    }

    return [...indexes];
  }

  private isPageWanted(controller: PageCacheController, page: number): boolean {
    return controller.desiredPages.has(page) || controller.pinnedPages.has(page);
  }

  private containsAll(container: Set<number>, values: Set<number>): boolean {
    for (const value of values) {
      if (!container.has(value)) return false;
    }
    return true;
  }

  private schedulePageCachePrune(tabId: string): void {
    const controller = this.getPageCacheController(tabId);
    if (controller.pruneTimer !== undefined) return;

    controller.pruneTimer = window.setTimeout(() => {
      controller.pruneTimer = undefined;
      const state = this.tabStates.get(tabId);
      if (!state) return;

      const retained = new Set([
        ...controller.desiredPages,
        ...controller.pinnedPages,
      ]);
      const evicted = state.allPages.filter(page => !retained.has(page.index));
      if (!evicted.length) return;

      for (const page of evicted) {
        try { URL.revokeObjectURL(page.url); } catch {}
      }
      state.allPages = state.allPages.filter(page => retained.has(page.index));
      this.emitState(tabId);
    }, 0);
  }

  private pausePageCache(tabId: string | null): void {
    if (!tabId) return;
    this.cancelPageRenderRequests(tabId, false);
  }

  private invalidatePageCache(tabId: string): void {
    this.cancelPageRenderRequests(tabId, true);
    this.pageCacheControllers.delete(tabId);
  }

  private cancelPageRenderRequests(tabId: string, clearDesiredPages: boolean): void {
    const controller = this.pageCacheControllers.get(tabId);
    if (!controller) return;

    controller.generation++;
    if (controller.pruneTimer !== undefined) {
      clearTimeout(controller.pruneTimer);
      controller.pruneTimer = undefined;
    }

    for (const request of controller.pending.values()) {
      request.resolve(false);
    }
    controller.queue = [];
    controller.pending.clear();
    controller.pinnedPages.clear();
    if (clearDesiredPages) controller.desiredPages.clear();
  }

  updateThumbnailCacheWindow(tabId: string, pageIndexes: number[]): void {
    const state = this.tabStates.get(tabId);
    if (!state || !state.document) return;

    const controller = this.getThumbnailCacheController(tabId);
    controller.desiredPages = new Set(this.normalizePageIndexes(state, pageIndexes));

    if (this.containsAll(controller.desiredPages, controller.pinnedPages)) {
      controller.pinnedPages.clear();
    }

    this.scheduleThumbnailCachePrune(tabId);
    void this.requestThumbnails(tabId, [...controller.desiredPages]);
  }

  async ensureThumbnailLoaded(tabId: string, pageNumber: number): Promise<void> {
    await this.requestThumbnails(tabId, [pageNumber], true);
  }

  private getThumbnailCacheController(tabId: string): ThumbnailCacheController {
    let controller = this.thumbnailCacheControllers.get(tabId);

    if (!controller) {
      controller = {
        desiredPages: new Set<number>(),
        pinnedPages: new Set<number>(),
        queue: [],
        pending: new Map<number, ThumbnailRenderRequest>(),
        processing: false,
        generation: 0,
      };
      this.thumbnailCacheControllers.set(tabId, controller);
    }

    return controller;
  }

  private async requestThumbnails(
    tabId: string,
    pageIndexes: number[],
    pinPages = false,
  ): Promise<boolean[]> {
    const state = this.tabStates.get(tabId);
    if (!state || !state.document || this.activeTabId !== tabId) return [];

    const controller = this.getThumbnailCacheController(tabId);
    const indexes = this.normalizePageIndexes(state, pageIndexes);

    if (pinPages) {
      controller.pinnedPages = new Set(indexes);
      this.scheduleThumbnailCachePrune(tabId);
    }

    const requests = indexes.map(page => this.enqueueThumbnailRender(tabId, page));
    this.startThumbnailRenderQueue(tabId);
    return Promise.all(requests);
  }

  private enqueueThumbnailRender(tabId: string, page: number): Promise<boolean> {
    const state = this.tabStates.get(tabId);
    const thumb = state?.thumbs[page - 1];
    if (!thumb || thumb.url) return Promise.resolve(true);

    const controller = this.getThumbnailCacheController(tabId);
    const pending = controller.pending.get(page);
    if (pending) return pending.promise;

    let resolve!: (loaded: boolean) => void;
    const promise = new Promise<boolean>(done => {
      resolve = done;
    });
    const request: ThumbnailRenderRequest = { page, resolve, promise };
    controller.pending.set(page, request);
    controller.queue.unshift(request);
    return promise;
  }

  private startThumbnailRenderQueue(tabId: string): void {
    const controller = this.getThumbnailCacheController(tabId);
    if (controller.processing) return;

    controller.processing = true;
    void this.processThumbnailRenderQueue(tabId, controller);
  }

  private async processThumbnailRenderQueue(
    tabId: string,
    controller: ThumbnailCacheController,
  ): Promise<void> {
    try {
      while (controller.queue.length) {
        const request = controller.queue.shift()!;
        const generation = controller.generation;
        const state = this.tabStates.get(tabId);
        const document = state?.document;

        if (
          !state ||
          !document ||
          this.activeTabId !== tabId ||
          !this.isThumbnailWanted(controller, request.page)
        ) {
          if (controller.pending.get(request.page) === request) {
            controller.pending.delete(request.page);
          }
          request.resolve(false);
          continue;
        }

        try {
          const rendered = await document.renderPage(request.page, {
            targetWidth: 300,
            quality: 1,
          });
          const currentState = this.tabStates.get(tabId);

          if (
            currentState !== state ||
            currentState.document !== document ||
            controller.generation !== generation ||
            this.activeTabId !== tabId ||
            !this.isThumbnailWanted(controller, request.page)
          ) {
            request.resolve(false);
            continue;
          }

          const currentThumb = currentState.thumbs[request.page - 1];
          if (!currentThumb || currentThumb.url) {
            request.resolve(Boolean(currentThumb?.url));
            continue;
          }

          const url = URL.createObjectURL(rendered.blob);
          if (!this.isThumbnailWanted(controller, request.page)) {
            URL.revokeObjectURL(url);
            request.resolve(false);
            continue;
          }

          currentThumb.url = url;
          currentThumb.width = rendered.width;
          currentThumb.height = rendered.height;
          this.emitState(tabId);
          request.resolve(true);
        } catch (err) {
          if (controller.generation === generation) {
            console.warn(`Error loading thumbnail ${request.page}:`, err);
          }
          request.resolve(false);
        } finally {
          if (controller.pending.get(request.page) === request) {
            controller.pending.delete(request.page);
          }
        }
      }
    } finally {
      controller.processing = false;
      if (controller.queue.length) {
        this.startThumbnailRenderQueue(tabId);
      }
    }
  }

  private isThumbnailWanted(controller: ThumbnailCacheController, page: number): boolean {
    return controller.desiredPages.has(page) || controller.pinnedPages.has(page);
  }

  private scheduleThumbnailCachePrune(tabId: string): void {
    const controller = this.getThumbnailCacheController(tabId);
    if (controller.pruneTimer !== undefined) return;

    controller.pruneTimer = window.setTimeout(() => {
      controller.pruneTimer = undefined;
      const state = this.tabStates.get(tabId);
      if (!state) return;

      const retained = new Set([
        ...controller.desiredPages,
        ...controller.pinnedPages,
      ]);
      let changed = false;

      for (const thumb of state.thumbs) {
        if (!thumb.url || retained.has(thumb.index)) continue;
        try { URL.revokeObjectURL(thumb.url); } catch {}
        thumb.url = null;
        changed = true;
      }

      if (changed) this.emitState(tabId);
    }, 0);
  }

  private pauseThumbnailCache(tabId: string | null): void {
    if (!tabId) return;
    this.cancelThumbnailRenderRequests(tabId, false);
  }

  private invalidateThumbnailCache(tabId: string): void {
    this.cancelThumbnailRenderRequests(tabId, true);
    this.thumbnailCacheControllers.delete(tabId);
  }

  private cancelThumbnailRenderRequests(tabId: string, clearDesiredPages: boolean): void {
    const controller = this.thumbnailCacheControllers.get(tabId);
    if (!controller) return;

    controller.generation++;
    if (controller.pruneTimer !== undefined) {
      clearTimeout(controller.pruneTimer);
      controller.pruneTimer = undefined;
    }

    for (const request of controller.pending.values()) {
      request.resolve(false);
    }
    controller.queue = [];
    controller.pending.clear();
    controller.pinnedPages.clear();
    if (clearDesiredPages) controller.desiredPages.clear();
  }

  async ensurePageLoaded(tabId: string, pageNumber: number): Promise<boolean> {
    const state = this.tabStates.get(tabId);
    if (!state || !state.document) return false;

    const p = Math.max(1, Math.min(pageNumber, state.totalPages));
    const exists = state.allPages.some(page => page.index === p);

    if (exists) return true;

    await this.loadPagesByIndexes(tabId, [p], true);

    return state.allPages.some(page => page.index === p);
  }

  async ensurePageWindowLoaded(tabId: string, pageNumber: number, radius = 1): Promise<void> {
    const state = this.tabStates.get(tabId);
    if (!state || !state.document) return;

    const indexes: number[] = [];

    for (let offset = -radius; offset <= radius; offset++) {
      indexes.push(pageNumber + offset);
    }

    await this.loadPagesByIndexes(tabId, indexes, true);
  }

  getState(tabId: string): TabState | null {
    return this.tabStates.get(tabId) || null;
  }

  private persistTabs() {
    try {
      localStorage.setItem(this.LS_TABS, JSON.stringify(this.tabs));
      localStorage.setItem(this.LS_ACTIVE, JSON.stringify(this.activeTabId));
    } catch {}
  }

  private restoreTabs() {
    try {
      const tabsRaw = localStorage.getItem(this.LS_TABS);
      const activeRaw = localStorage.getItem(this.LS_ACTIVE);

      const tabs: Tab[] = tabsRaw ? JSON.parse(tabsRaw) : [];
      const active: string | null = activeRaw ? JSON.parse(activeRaw) : null;

      this.tabsSubject.next(Array.isArray(tabs) ? tabs : []);
      this.activeTabIdSubject.next(active);

      for (const t of this.tabsSubject.value) {
        if (!this.tabStates.has(t.id)) {
          this.tabStates.set(t.id, this.createEmptyState(t.id, t.book.url));
        }
      }
      if (active) {
        queueMicrotask(() => {
          void this.router.navigate(
            ['/reader', active],
            { replaceUrl: true },
          );
        });
      }

      this.touchActiveBook(active);
    } catch {
      this.tabsSubject.next([]);
      this.activeTabIdSubject.next(null);
    }
  }

  private markBookOpened(book: Book) {
    const nowIso = new Date().toISOString();
    book.lastOpenedAt = nowIso;
    this.persistTabs();
    void this.saveBookMetaToBackend(book.id, { lastOpenedAt: nowIso });
  }

  private createEmptyState(tabId: string, bookUrl: string): TabState {
    return {
      id: tabId,
      pages: [],
      thumbs: [],
      allPages: [],
      currentPage: this.restoreLastPage(bookUrl) ?? 1,
      layoutMode: 'single',
      fitMode: 'width',
      zoom: 1,
      textSelectionEnabled: false,
      totalPages: 0,
      loadingProgress: 0,
      loadingDone: false,
      loading: false
    };
  }

  updateReaderDisplay(
    tabId: string,
    patch: Partial<Pick<TabState, 'layoutMode' | 'fitMode' | 'zoom' | 'textSelectionEnabled'>>,
  ) {
    const state = this.tabStates.get(tabId);
    if (!state) return;

    let changed = false;
    if (patch.layoutMode !== undefined) {
      changed ||= state.layoutMode !== patch.layoutMode;
      state.layoutMode = patch.layoutMode;
    }
    if (patch.fitMode !== undefined) {
      changed ||= state.fitMode !== patch.fitMode;
      state.fitMode = patch.fitMode;
    }
    if (patch.zoom !== undefined) {
      changed ||= state.zoom !== patch.zoom;
      state.zoom = patch.zoom;
    }
    if (patch.textSelectionEnabled !== undefined) {
      changed ||= state.textSelectionEnabled !== patch.textSelectionEnabled;
      state.textSelectionEnabled = patch.textSelectionEnabled;
    }

    if (changed) {
      this.emitState(tabId);
    }
  }

  private pageKey(bookUrl: string) {
    return `${this.LS_PAGE_PREFIX}${bookUrl}`;
  }

  restoreLastPage(bookUrl: string): number | null {
    const key = this.pageKey(bookUrl);
    const v = localStorage.getItem(key);
    const n = Number(v);

    return Number.isFinite(n) && n >= 1 ? n : null;
  }

  saveLastPage(bookUrl: string, page: number) {
    const p = Math.max(1, Math.floor(Number(page) || 1));
    localStorage.setItem(this.pageKey(bookUrl), String(p));
  }

  ensureTabState(tabId: string): TabState | null {
    const tab = this.tabs.find(t => t.id === tabId);
    if (!tab) return null;

    let state = this.tabStates.get(tabId);
    if (!state) {
      state = this.createEmptyState(tabId, tab.book.url);
      this.tabStates.set(tabId, state);
    }
    return state;
  }

  private getBookUrlByTabId(tabId: string): string | null {
    const tab = this.tabs.find(t => t.id === tabId);
    return tab?.book?.url ?? null;
  }

  saveCurrentPage(tabId: string, page: number) {
    const tab = this.tabs.find(t => t.id === tabId);
    const bookUrl = tab?.book?.url;
    if (!bookUrl) return;
    this.saveLastPage(bookUrl, page);
  }

  getSavedPageForTab(tabId: string): number | null {
    const bookUrl = this.getBookUrlByTabId(tabId);
    if (!bookUrl) return null;
    return this.restoreLastPage(bookUrl);
  }

  getTabInfo(tabId: string): Tab | undefined {
    return this.tabs.find(t => t.id === tabId);
  }

  setHomeActive() {
    this.pausePageCache(this.activeTabId);
    this.pauseThumbnailCache(this.activeTabId);
    this.activeTabIdSubject.next(null);
    this.persistTabs();
  }

  async saveTotalPagesToBackend(bookId: string, totalPages: number) {
    if (!bookId || !totalPages) return;

    await this.saveBookMetaToBackend(bookId, { totalPages });
  }

  async saveBookMetaToBackend(
    bookId: string,
    patch: {
      totalPages?: number | null;
      lastOpenedAt?: string | null;
    }
  ) {
    if (!bookId) return;

    try {
      await fetch(`${environment.apiBase}/api/books/${encodeURIComponent(bookId)}/meta`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      });
    } catch (e) {
      console.warn('Failed to save book meta:', e);
    }
  }

  private getStateSubject(
    tabId: string,
    state: TabState
  ): BehaviorSubject<TabState> {
    let subject = this.tabStateSubjects.get(tabId);

    if (!subject) {
      subject = new BehaviorSubject<TabState>(state);
      this.tabStateSubjects.set(tabId, subject);
    }

    return subject;
  }

  getState$(tabId: string) {
    const state = this.ensureTabState(tabId);

    if (!state) {
      throw new Error(`Tab state not found: ${tabId}`);
    }

    return this.getStateSubject(tabId, state).asObservable();
  }

  private emitState(tabId: string) {
    const state = this.tabStates.get(tabId);
    if (!state) return;

    this.getStateSubject(tabId, state).next(state);
  }

  reorderTabs(previousIndex: number, currentIndex: number) {
    const tabs = [...this.tabs];

    const [moved] = tabs.splice(previousIndex, 1);
    tabs.splice(currentIndex, 0, moved);

    this.tabsSubject.next(tabs);
    this.persistTabs();
  }

  private readingPositionKey(bookUrl: string) {
    return `${this.LS_READING_POSITION_PREFIX}${bookUrl}`;
  }

  saveReadingPosition(tabId: string, position: ReadingPosition) {
    const bookUrl = this.getBookUrlByTabId(tabId);
    if (!bookUrl) return;

    const normalized: ReadingPosition = {
      page: Math.max(1, Math.floor(position.page)),
      offsetRatio: Math.max(
        0,
        Math.min(1, position.offsetRatio)
      ),
    };

    localStorage.setItem(
      this.readingPositionKey(bookUrl),
      JSON.stringify(normalized)
    );
  }

  getSavedReadingPosition(tabId: string): ReadingPosition | null {
    const bookUrl = this.getBookUrlByTabId(tabId);
    if (!bookUrl) return null;

    const raw = localStorage.getItem(
      this.readingPositionKey(bookUrl)
    );

    if (!raw) return null;

    try {
      const position = JSON.parse(raw) as ReadingPosition;

      if (
        !Number.isFinite(position.page) ||
        !Number.isFinite(position.offsetRatio)
      ) {
        return null;
      }

      return {
        page: Math.max(1, Math.floor(position.page)),
        offsetRatio: Math.max(
          0,
          Math.min(1, position.offsetRatio)
        ),
      };
    } catch {
      return null;
    }
  }

  private getHistory(tabId: string): ReadingHistory {
    let history = this.tabHistories.get(tabId);

    if (!history) {
      history = new ReadingHistory(30);
      this.tabHistories.set(tabId, history);
    }

    return history;
  }

  pushHistory(tabId: string, position: ReadingPosition) {
    this.getHistory(tabId).push(position);
  }

  goBackInHistory(tabId: string): ReadingPosition | null {
    return this.getHistory(tabId).back();
  }

  goForwardInHistory(tabId: string): ReadingPosition | null {
    return this.getHistory(tabId).forward();
  }

  canGoBack(tabId: string): boolean {
    return this.getHistory(tabId).canGoBack();
  }

  canGoForward(tabId: string): boolean {
    return this.getHistory(tabId).canGoForward();
  }

  navigateInHistory(tabId: string, from: ReadingPosition, to: ReadingPosition) {
    const history = this.getHistory(tabId);

    if (history.isEmpty) {
      history.push(from);
    } else {
      history.updateCurrent(from);
    }

    history.push(to);
  }

  getBackHistoryPosition(tabId: string): ReadingPosition | null {
    return this.getHistory(tabId).getBackPosition();
  }

  getForwardHistoryPosition(tabId: string): ReadingPosition | null {
    return this.getHistory(tabId).getForwardPosition();
  }

  updateCurrentHistoryPosition(tabId: string, position: ReadingPosition) {
    this.getHistory(tabId).updateCurrent(position);
  }

}
