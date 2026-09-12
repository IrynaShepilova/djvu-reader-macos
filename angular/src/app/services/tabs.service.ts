import { Injectable } from '@angular/core';
import {BehaviorSubject, defer} from 'rxjs';
import { Tab } from '../interfaces/tab';
import { Book } from '../interfaces/book';
import {ReadingPosition, TabState} from '../interfaces/tabState';
import {environment} from '../../environments/environment';
import { Router } from '@angular/router';
import { ReadingHistory } from '../classes/reading-history';
import { DocumentService } from './document.service';

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

  private readonly loadVersions = new Map<string, number>();

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
    this.activeTabIdSubject.next(id);

    this.markBookOpened(newTab.book);

    return id;
  }

  closeTab(id: string) {
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

    this.activeTabIdSubject.next(id);
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

    const loadVersion = (this.loadVersions.get(tabId) ?? 0) + 1;
    this.loadVersions.set(tabId, loadVersion);

    const state = this.ensureTabState(tabId);
    if (!state) return;

    if (state.loading) return;

    if (!forceReload && state.allPages.length > 0 && state.document) return;

    state.loading = true;
    state.loadingProgress = 0;
    this.emitState(tabId);
    state.loadingDone = false;

    if (forceReload) {
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

      await this.saveTotalPagesToBackend(tab.book.id, state.totalPages);

      state.currentPage = Math.max(1, Math.min(state.currentPage || 1, state.totalPages));

      await this.loadInitialPages(tabId, 2);

      state.loadingDone = true;
      this.emitState(tabId);

      void this.loadRemainingPagesInBackground(tabId, 10, loadVersion);

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
    for (const p of state.pages ?? []) {
      try { URL.revokeObjectURL(p.url); } catch {}
    }
    for (const t of state.thumbs ?? []) {
      try { URL.revokeObjectURL(t.url); } catch {}
    }
  }


  async loadAllPages(tabId: string, batchSize = 10): Promise<void> {
    const state = this.tabStates.get(tabId);
    if (!state || !state.document) return;

    const document = state.document;
    const total = state.totalPages;
    let i = 1;

    return new Promise<void>((resolve) => {
      const loadBatch = async () => {
        const batch = [];

        for (let p = i; p < i + batchSize && p <= total; p++) {
          try {
            const page = await document.renderPage(p);
            const url = URL.createObjectURL(page.blob);

            batch.push({
              index: p,
              url,
              width: page.width,
              height: page.height,
            });

          } catch (err) {
            console.warn(`Error loading page ${p}:`, err);
          }
        }

        state.allPages.push(...batch);

        const loadedCount = Math.min(i + batchSize - 1, total);
        state.loadingProgress = Math.round((loadedCount / total) * 100);
        this.emitState(tabId);

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
    const state = this.tabStates.get(tabId);
    if (!state) return;

    const current = Math.max(1, Math.min(state.currentPage || 1, state.totalPages));
    const indexes: number[] = [];

    indexes.push(current);

    for (let offset = 1; offset <= radius; offset++) {
      indexes.push(current - offset, current + offset);
    }

    await this.loadPagesByIndexes(tabId, indexes);
  }

  private async loadRemainingPagesInBackground(
    tabId: string,
    batchSize = 10,
    loadVersion: number,
  ): Promise<void> {
    const state = this.tabStates.get(tabId);

    if (
      !state ||
      !state.document ||
      this.loadVersions.get(tabId) !== loadVersion
    ) {
      return;
    }

    const current = Math.max(
      1,
      Math.min(state.currentPage || 1, state.totalPages)
    );

    const ordered = this.buildRemainingPageOrder(
      current,
      state.totalPages
    );

    let cursor = 0;

    return new Promise<void>((resolve) => {
      const loadBatch = async () => {
        const freshState = this.tabStates.get(tabId);

        if (
          !freshState ||
          !freshState.document ||
          this.loadVersions.get(tabId) !== loadVersion
        ) {
          resolve();
          return;
        }

        const alreadyLoaded = new Set(
          freshState.allPages.map(page => page.index)
        );

        const batch: number[] = [];

        while (
          cursor < ordered.length &&
          batch.length < batchSize
          ) {
          const page = ordered[cursor++];

          if (!alreadyLoaded.has(page)) {
            batch.push(page);
          }
        }

        if (batch.length > 0) {
          await this.loadPagesByIndexes(tabId, batch);
        }

        if (this.loadVersions.get(tabId) !== loadVersion) {
          resolve();
          return;
        }

        if (cursor < ordered.length) {
          if ('requestIdleCallback' in window) {
            window.requestIdleCallback(() => {
              void loadBatch();
            });
          } else {
            setTimeout(() => {
              void loadBatch();
            }, 0);
          }
        } else {
          resolve();
        }
      };

      void loadBatch();
    });
  }

  private async loadPagesByIndexes(tabId: string, indexes: number[]): Promise<void> {
    const state = this.tabStates.get(tabId);
    if (!state || !state.document) return;

    const document = state.document;
    const existingIndexes = new Set(state.allPages.map(p => p.index));

    for (const rawIndex of indexes) {
      if (this.tabStates.get(tabId)?.document !== document) return;

      const p = Math.max(1, Math.min(rawIndex, state.totalPages));

      if (existingIndexes.has(p)) continue;

      try {
        const page = await document.renderPage(p);

        if (this.tabStates.get(tabId)?.document !== document) return;

        const url = URL.createObjectURL(page.blob);

        if (state.allPages.some(existing => existing.index === p)) {
          URL.revokeObjectURL(url);
          continue;
        }

        state.allPages.push({
          index: p,
          url,
          width: page.width,
          height: page.height,
        });

        existingIndexes.add(p);
        state.allPages.sort((a, b) => a.index - b.index);

        state.loadingProgress = Math.round((state.allPages.length / state.totalPages) * 100);
        this.emitState(tabId);
      } catch (err) {
        if (this.tabStates.get(tabId)?.document !== document) return;
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

  getTabInfo(tabId: string): Tab | undefined {
    return this.tabs.find(t => t.id === tabId);
  }

  setHomeActive() {
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
