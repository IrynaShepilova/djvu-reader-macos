import { Injectable } from '@angular/core';
import {BehaviorSubject, defer} from 'rxjs';
import { Tab } from '../interfaces/tab';
import { Book } from '../interfaces/book';
import {TabState} from '../interfaces/tabState';
import {environment} from '../../environments/environment';

declare const DjVu: any;

@Injectable({ providedIn: 'root' })
export class TabsService {
  private tabsSubject = new BehaviorSubject<Tab[]>([]);
  tabs$ = this.tabsSubject.asObservable();

  private activeTabIdSubject = new BehaviorSubject<string | null>(null);
  activeTabId$ = this.activeTabIdSubject.asObservable();

  private tabStates = new Map<string, TabState>();

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
      return existing.id;
    }

    const id = crypto.randomUUID();
    const newTab: Tab = {
      id,
      title: book.title,
      book,
    };

    this.tabStates.set(id, {
      pages: [],
      thumbs: [],
      allPages: [],
      currentPage: 1,
      totalPages: 0,
      loadingProgress: 0,
      loadingDone: false,
      loading: false
    });

    this.tabsSubject.next([...this.tabs, newTab]);
    this.activeTabIdSubject.next(id);

    return id;
  }

  closeTab(id: string) {
    const remaining = this.tabs.filter(t => t.id !== id);
    this.tabsSubject.next(remaining);

    this.tabStates.delete(id);

    if (this.activeTabId === id) {
      const next = remaining[remaining.length - 1] || null;
      this.activeTabIdSubject.next(next ? next.id : null);
    }
  }

  setActive(id: string) {
    const exists = this.tabs.some(t => t.id === id);
    if (exists) {
      this.activeTabIdSubject.next(id);
    }
  }

  async loadBook(tabId: string): Promise<void> {
    const state = this.tabStates.get(tabId);
    const tab = this.tabs.find(t => t.id === tabId);
    if (!state || !tab) return;

    if (state.loadingDone || state.loading) return;

    state.loading = true;
    state.loadingProgress = 0;
    state.allPages = [];

    try {
      const fileUrl = `${environment.apiBase}${tab.book.url}`;
      const buf = await fetch(decodeURI(fileUrl)).then(r => r.arrayBuffer());

      const doc = new DjVu.Document(buf);
      state.document = doc;
      state.totalPages = this.getTotalPages(doc);

      await this.loadAllPages(tabId);  // теперь ждёт ЗАВЕРШЕНИЯ загрузки

      state.loadingDone = true;
    } catch (err) {
      console.error('DjVu load failed:', err);
    } finally {
      state.loading = false;
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


}

