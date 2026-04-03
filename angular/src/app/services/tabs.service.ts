import { Injectable } from '@angular/core';
import {BehaviorSubject, defer} from 'rxjs';
import { Tab } from '../interfaces/tab';
import { Book } from '../interfaces/book';
import {TabState} from '../interfaces/tabState';
import {environment} from '../../environments/environment';

declare const DjVu: any;

@Injectable({ providedIn: 'root' })
export class TabsService {

  constructor() {
    this.restoreTabs();
  }

  private tabsSubject = new BehaviorSubject<Tab[]>([]);
  tabs$ = this.tabsSubject.asObservable();

  private activeTabIdSubject = new BehaviorSubject<string | null>(null);
  activeTabId$ = this.activeTabIdSubject.asObservable();

  private tabStates = new Map<string, TabState>();

  private readonly LS_TABS = 'djvu.tabs.v1';
  private readonly LS_ACTIVE = 'djvu.activeTabId.v1';
  private readonly LS_PAGE_PREFIX = 'djvu.lastPageByBookUrl.v1:'; // key = prefix + book.url


  get tabs(): Tab[] {
    return this.tabsSubject.value;
  }

  get activeTabId(): string | null {
    return this.activeTabIdSubject.value;
  }

  openBook(book: Book): string {
    const existing = this.tabs.find(t => t.book.url === book.url);
    if (existing) {
      this.activeTabIdSubject.next(existing.id);
      this.persistTabs();
      return existing.id;
    }

    const id = crypto.randomUUID();
    const newTab: Tab = {
      id,
      title: book.title,
      book,
    };

    this.tabStates.set(id, this.createEmptyState(id, book.url));
    this.tabsSubject.next([...this.tabs, newTab]);
    this.activeTabIdSubject.next(id);
    this.persistTabs();

    return id;
  }

  closeTab(id: string) {
    const st = this.tabStates.get(id);
    if (st) {
      this.revokeStateUrls(st);
      st.document = undefined;

      st.allPages = [];
      st.pages = [];
      st.thumbs = [];
    }

    const remaining = this.tabs.filter(t => t.id !== id);
    this.tabsSubject.next(remaining);

    this.tabStates.delete(id);

    if (this.activeTabId === id) {
      const next = remaining[remaining.length - 1] || null;
      this.activeTabIdSubject.next(next ? next.id : null);
    }

    this.persistTabs();
  }


  setActive(id: string) {
    const exists = this.tabs.some(t => t.id === id);
    if (exists) {
      this.activeTabIdSubject.next(id);
    }
    this.persistTabs();
  }

  async loadBook(tabId: string, forceReload = false): Promise<void> {
    const tab = this.tabs.find(t => t.id === tabId);
    if (!tab) return;

    const state = this.ensureTabState(tabId);
    if (!state) return;

    if (state.loading) return;

    if (!forceReload && state.allPages.length > 0 && state.document) return;

    state.loading = true;
    state.loadingProgress = 0;
    state.loadingDone = false;

    if (forceReload) {
      this.revokeStateUrls(state);
      state.allPages = [];
      state.pages = [];
      state.thumbs = [];
      state.document = undefined;
      state.totalPages = 0;
    }

    try {
      const fileUrl = `${environment.apiBase}${tab.book.url}`;
      const buf = await fetch(decodeURI(fileUrl)).then(r => r.arrayBuffer());

      const doc = new DjVu.Document(buf);
      state.document = doc;
      state.totalPages = this.getTotalPages(doc);

      await this.saveTotalPagesToBackend(tab.book.id, state.totalPages);

      state.currentPage = Math.max(1, Math.min(state.currentPage || 1, state.totalPages));

      await this.loadInitialPages(tabId, 2);

      state.loadingDone = true;

      void this.loadRemainingPagesInBackground(tabId, 10);

    } catch (err) {
      console.error('DjVu load failed:', err);
    } finally {
      state.loading = false;
    }
  }

  private revokeStateUrls(state: TabState) {
    for (const p of state.allPages ?? []) {
      try { URL.revokeObjectURL(p.url); } catch {}
    }
    for (const p of state.pages ?? []) {
      try { URL.revokeObjectURL(p.url); } catch {}
    }
    for (const t of state.thumbs ?? []) {
      try { URL.revokeObjectURL(t.url); } catch {}
    }
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

  async loadAllPages(tabId: string, batchSize = 10): Promise<void> {
    const state = this.tabStates.get(tabId);
    if (!state || !state.document) return;

    const total = state.totalPages;
    let i = 1;

    return new Promise<void>((resolve) => {
      const loadBatch = async () => {
        const batch = [];

        for (let p = i; p < i + batchSize && p <= total; p++) {
          try {
            const page = await state.document.getPage(p);
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

        state.allPages.push(...batch);

        const loadedCount = Math.min(i + batchSize - 1, total);
        state.loadingProgress = Math.round((loadedCount / total) * 100);

        i += batchSize;

        if (i <= total) {
          if ('requestIdleCallback' in window) {
            (window as any).requestIdleCallback(loadBatch);
          } else {
            setTimeout(loadBatch, 0);
          }
        } else {
          resolve();
        }
      };

      loadBatch();
    });
  }

  private async loadInitialPages(tabId: string, radius = 2): Promise<void> {
    console.log('loadInitialPages', );
    const state = this.tabStates.get(tabId);
    if (!state) return;
    console.log('state.currentPage', state.currentPage);

    const current = Math.max(1, Math.min(state.currentPage || 1, state.totalPages));
    const indexes: number[] = [];

    indexes.push(current);

    for (let offset = 1; offset <= radius; offset++) {
      indexes.push(current - offset, current + offset);
    }

    await this.loadPagesByIndexes(tabId, indexes);
  }

  private async loadRemainingPagesInBackground(tabId: string, batchSize = 10): Promise<void> {
    console.log('loadRemainingPagesInBackground', );
    const state = this.tabStates.get(tabId);
    if (!state || !state.document) return;

    const current = Math.max(1, Math.min(state.currentPage || 1, state.totalPages));
    const ordered = this.buildRemainingPageOrder(current, state.totalPages);

    let cursor = 0;

    return new Promise<void>((resolve) => {
      const loadBatch = async () => {
        const freshState = this.tabStates.get(tabId);
        if (!freshState || !freshState.document) {
          resolve();
          return;
        }

        const alreadyLoaded = new Set(freshState.allPages.map(p => p.index));
        const batch: number[] = [];

        while (cursor < ordered.length && batch.length < batchSize) {
          const page = ordered[cursor++];
          if (!alreadyLoaded.has(page)) {
            batch.push(page);
          }
        }

        if (batch.length > 0) {
          await this.loadPagesByIndexes(tabId, batch);
        }

        if (cursor < ordered.length) {
          if ('requestIdleCallback' in window) {
            (window as any).requestIdleCallback(loadBatch);
          } else {
            setTimeout(loadBatch, 0);
          }
        } else {
          resolve();
        }
      };

      loadBatch();
    });
  }

  private async loadPagesByIndexes(tabId: string, indexes: number[]): Promise<void> {
    const state = this.tabStates.get(tabId);
    if (!state || !state.document) return;

    const existingIndexes = new Set(state.allPages.map(p => p.index));

    for (const rawIndex of indexes) {
      const p = Math.max(1, Math.min(rawIndex, state.totalPages));

      if (existingIndexes.has(p)) continue;

      try {
        const page = await state.document.getPage(p);
        const imgData = await page.getImageData();
        const url = await this.imageDataToUrl(imgData);

        state.allPages.push({
          index: p,
          url,
          width: imgData.width,
          height: imgData.height
        });

        existingIndexes.add(p);

        state.allPages.sort((a, b) => a.index - b.index);

        state.loadingProgress = Math.round((state.allPages.length / state.totalPages) * 100);
      } catch (err) {
        console.warn(`Error loading page ${p}:`, err);
      }
    }
  }

  private buildRemainingPageOrder(current: number, total: number): number[] {
    const result: number[] = [];
    const seen = new Set<number>();

    const push = (page: number) => {
      if (page < 1 || page > total || seen.has(page)) return;
      seen.add(page);
      result.push(page);
    };

    push(current);

    for (let offset = 1; offset <= total; offset++) {
      push(current - offset);
      push(current + offset);
    }

    return result;
  }

  async ensurePageLoaded(tabId: string, pageNumber: number): Promise<boolean> {
    const state = this.tabStates.get(tabId);
    if (!state || !state.document) return false;

    const p = Math.max(1, Math.min(pageNumber, state.totalPages));
    const exists = state.allPages.some(page => page.index === p);

    if (exists) return true;

    await this.loadPagesByIndexes(tabId, [p]);

    return state.allPages.some(page => page.index === p);
  }

  async ensurePageWindowLoaded(tabId: string, pageNumber: number, radius = 1): Promise<void> {
    const state = this.tabStates.get(tabId);
    if (!state || !state.document) return;

    const indexes: number[] = [];

    for (let offset = -radius; offset <= radius; offset++) {
      indexes.push(pageNumber + offset);
    }

    await this.loadPagesByIndexes(tabId, indexes);
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
    } catch {
      this.tabsSubject.next([]);
      this.activeTabIdSubject.next(null);
    }
  }

  private createEmptyState(tabId: string, bookUrl: string): TabState {
    return {
      id: tabId,
      pages: [],
      thumbs: [],
      allPages: [],
      currentPage: this.restoreLastPage(bookUrl) ?? 1,
      totalPages: 0,
      loadingProgress: 0,
      loadingDone: false,
      loading: false
    };
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

  setHomeActive() {
    this.activeTabIdSubject.next(null);
    this.persistTabs();
  }

  async saveTotalPagesToBackend(bookId: string, totalPages: number) {
    if (!bookId || !totalPages) return;

    try {
      await fetch(`${environment.apiBase}/api/books/${encodeURIComponent(bookId)}/meta`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ totalPages }),
      });
    } catch (e) {
      console.warn('Failed to save totalPages:', e);
    }
  }



}

