import {
  Component,
  computed,
  OnInit,
  signal,
  ViewChild,
  WritableSignal,
  ElementRef,
  HostListener,
  inject,
  Signal
} from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Router } from '@angular/router';
import { environment } from '../../../environments/environment';
import { Book } from '../../interfaces/book';
import { TabsService } from '../../services/tabs.service';
import { MatDialog } from '@angular/material/dialog';
import { DialogComponent } from '../dialog/dialog.component';
import {TabsBarComponent} from '../tabs-bar/tabs-bar.component';
import {FormsModule} from '@angular/forms';
import {timestamp} from 'rxjs';
import { ScanFolder } from '../../interfaces/scan-folder';
import { ScanFoldersService } from '../../services/scan-folders.service';
import { ScanFoldersDialogComponent } from '../scan-folders-dialog/scan-folders-dialog.component';
import { BookService } from '../../services/book.service';
import { ScanFoldersFacade } from '../../services/scan-folders-facade';
import { BookCardComponent } from '../book-card/book-card.component';
import { MatIcon } from '@angular/material/icon';
import {LibraryToolbarComponent} from '../library-toolbar/library-toolbar.component';

declare const DjVu: any;
type LibraryViewMode = 'tile' | 'list';
type SortMode = 'default' | 'lastOpened' |'byDirectory' | 'title' | 'category';

type DirectoryGroup = {
  title: string;
  scanFolder: ScanFolder;
  books: Book[];
};

@Component({
  selector: 'app-library',
  standalone: true,
  imports: [
    TabsBarComponent,
    FormsModule,
    BookCardComponent,
    MatIcon,
    LibraryToolbarComponent,
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
    private scanFoldersService: ScanFoldersService,
    private bookService: BookService,
    private scanFoldersFacade: ScanFoldersFacade,
  ) {
    this.scanFolders = this.scanFoldersFacade.scanFolders;
  }


  private readonly apiBase = environment.apiBase;

  books = signal<Book[]>([]);

  isScanning = signal(false);
  scanProgress = signal(0);
  scanProcessed = signal(0);
  scanTotal = signal(0);
  private scanPollTimeout: ReturnType<typeof setTimeout> | null = null;

  booksCount = computed(() => this.books().length);

  private previewCache = new Map<string, string>(); // book.id -> objectUrl
  private previewInFlight = new Set<string>();
  previewMap = signal<Record<string, string>>({});

  private previewsRunId = 0;

  private readonly LS_VIEW_MODE = 'djvu.library.viewMode.v1';
  private readonly LS_SORT = 'library.sortMode.v1';
  viewMode: LibraryViewMode = (localStorage.getItem(this.LS_VIEW_MODE) as LibraryViewMode) || 'tile';
  readonly sortMode = signal<SortMode>('default');
  sortOptions = [
    { value: 'default' as SortMode, label: 'Default' },
    { value: 'lastOpened' as SortMode, label: 'Last opened' },
    { value: 'byDirectory' as SortMode, label: 'By directory' },
    { value: 'title' as SortMode, label: 'Title' },
    { value: 'category' as SortMode, label: 'Category' },
  ];
  sortMenuOpen = false;

  private readonly el = inject(ElementRef<HTMLElement>);
  readonly scanFolders: Signal<ScanFolder[]>;
  collapsedGroups = signal(new Set<string>());

  searchOpen = signal(false);
  searchQuery = signal('');

  showScrollTop = signal(false);





  @HostListener('window:scroll')
  onWindowScroll() {
    this.showScrollTop.set(window.scrollY > window.innerHeight);
  }

  async ngOnInit() {
    const list = await this.loadBooks();
    this.books.set(this.enrichBooks(list));

    this.scrollToPreviousPosition();

    void this.scanFoldersFacade.loadFolders();

    await this.generatePreviews(list);
    const saved = localStorage.getItem(this.LS_SORT);
    if (saved) {
      this.sortMode.set(saved as SortMode);
    }
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
        if (runId !== this.previewsRunId) return;

        const b = queue[idx++];
        this.previewInFlight.add(b.id);

        try {
          const url = await this.buildPreview(b);
          if (runId !== this.previewsRunId) return;

          this.previewCache.set(b.id, url);
          this.previewMap.update(m => ({ ...m, [b.id]: url }));
        } catch (e) {
          console.warn('Preview failed', b, e);
          this.bookService.markInvalid(b.id).subscribe();
        } finally {
          this.previewInFlight.delete(b.id);
        }
      }
    };

    await Promise.all(Array.from({ length: concurrency }, worker));
  }

  private async buildPreview(b: Book): Promise<string> {
    const fileUrl = `${this.apiBase}${b.url}`;
    const buf = await fetch(fileUrl).then(r => r.arrayBuffer());    const doc = new (DjVu as any).Document(buf);
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
    this.saveCurrentScrollPosition(book);

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

    const stopPolling = () => {
      if (this.scanPollTimeout) {
        clearTimeout(this.scanPollTimeout);
        this.scanPollTimeout = null;
      }
    };

    const pollScanStatus = async () => {
      try {
        const st = await this.http
          .get<any>(`${this.apiBase}/api/books/scan/status`)
          .toPromise();

        if (!st) return;

        this.scanProgress.set(st.percent ?? 0);
        this.scanProcessed.set(st.processed ?? 0);
        this.scanTotal.set(st.total ?? 0);

        if (st.done && !st.running) {
          stopPolling();
          this.isScanning.set(false);

          const ref = this.dialog.open(DialogComponent, {
            width: '420px',
            data: {
              title: 'Scan complete',
              message: `Added: ${st.added ?? 0}. Total: ${st.total ?? this.books().length}`,
            }
          });

          ref.afterClosed().subscribe(() => {
            void this.refreshLibrary();
          });

          return;
        }

        this.scanPollTimeout = setTimeout(() => {
          void pollScanStatus();
        }, 500);

      } catch (e) {
        console.error(e);
        stopPolling();
        this.isScanning.set(false);

        this.dialog.open(DialogComponent, {
          width: '420px',
          data: {
            title: 'Scan failed',
            message: `There was an error scanning the library.`,
          }
        });
      }
    };

    try {
      await this.http.post(`${this.apiBase}/api/books/scan/start`, {}).toPromise();
      void pollScanStatus();
    } catch (e) {
      console.error(e);
      stopPolling();
      this.isScanning.set(false);

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
    this.books.set(this.enrichBooks(list));
    await this.generatePreviews(list);
    this.scrollToPreviousPosition();
  }

  setViewMode(mode: LibraryViewMode) {
    this.viewMode = mode;
    localStorage.setItem(this.LS_VIEW_MODE, mode);
  }

  toggleViewMode() {
    this.setViewMode(this.viewMode === 'tile' ? 'list' : 'tile');
  }

  private enrichBooks(books: Book[]): Book[] {
    return books.map(b => {
      const total = Number(b.totalPages);

      const isNew = !Number.isFinite(total) || total < 1;

      if (isNew) {
        return { ...b, isNew: true, progressPercent: null };
      }

      const last = this.tabsService.restoreLastPage(b.url) ?? 1;
      const pct = Math.round((Math.min(last, total) / total) * 100);

      return {
        ...b,
        isNew: this.tabsService.restoreLastPage(b.url) == null,
        progressPercent: Math.max(0, Math.min(100, pct)),
      };
    });
  }

  readonly sortedBooks = computed(() =>
    this.sortBooks(this.filteredBooks(), this.sortMode())
  );

  readonly directoryGroups = computed<DirectoryGroup[]>(() => {
    const books = this.filteredBooks();
    const folders = this.scanFolders();

    const map = new Map<string, DirectoryGroup>();

    for (const book of books) {
      const scanFolder = this.findScanFolderForBook(book, folders);

      if (!scanFolder) continue;

      const title = this.getRelativeDirectoryTitle(book, scanFolder);
      const key = `${scanFolder.id}::${title}`;

      const existing = map.get(key);

      if (existing) {
        existing.books.push(book);
      } else {
        map.set(key, {
          title,
          scanFolder,
          books: [book],
        });
      }
    }

    return [...map.values()].sort((a, b) => {
      const aNetwork = this.isNetworkFolder(a.scanFolder);
      const bNetwork = this.isNetworkFolder(b.scanFolder);

      if (aNetwork !== bNetwork) {
        return aNetwork ? 1 : -1;
      }

      return a.title.localeCompare(b.title);
    });
  });

  private sortBooks(books: Book[], mode: SortMode): Book[] {
    const list = [...books];

    switch (mode) {
      case 'lastOpened':
        return list.sort(this.compareByLastOpened);

      case 'title':
        return list.sort(this.compareByTitle);

      case 'category':
        return list.sort(this.compareByCategory);

      case 'default':
      default:
        return list;
    }
  }

  private compareByLastOpened = (a: Book, b: Book): number => {
    const aTime = a.lastOpenedAt ? new Date(a.lastOpenedAt).getTime() : 0;
    const bTime = b.lastOpenedAt ? new Date(b.lastOpenedAt).getTime() : 0;
    return bTime - aTime;
  };

  private compareByTitle = (a: Book, b: Book): number => {
    return a.title.localeCompare(b.title);
  };

  private compareByCategory = (a: Book, b: Book): number => {
    const aCategory = a.category ?? '';
    const bCategory = b.category ?? '';

    const categoryCompare = aCategory.localeCompare(bCategory);
    if (categoryCompare !== 0) return categoryCompare;

    return a.title.localeCompare(b.title);
  };

  private findScanFolderForBook(book: Book, folders: ScanFolder[]): ScanFolder | null {
    const fullPath = book.fullPath;

    if (!fullPath) return null;

    return folders.find(folder =>
      fullPath.startsWith(folder.path + '/')
    ) ?? null;
  }

  private isDefaultBooksFolder(folder: ScanFolder): boolean {
    return folder.id === 'default-books';
  }

  private isDefaultDownloadsFolder(folder: ScanFolder): boolean {
    return folder.id === 'default-downloads';
  }

  private getRelativeDirectoryTitle(book: Book, folder: ScanFolder): string {
    const fullPath = book.fullPath;
    if (!fullPath) return 'Unknown';

    const folderName = folder.path.split('/').filter(Boolean).pop() ?? folder.path;

    if (this.isDefaultBooksFolder(folder)) {
      return 'Books';
    }

    if (this.isDefaultDownloadsFolder(folder)) {
      return 'Downloads';
    }

    const relativePath = fullPath.replace(folder.path + '/', '');
    const parts = relativePath.split('/');

    parts.pop(); // filename

    if (this.isNetworkFolder(folder)) {
      return parts.length
        ? parts.slice(0, 2).join(' / ')
        : folderName;
    }

    return folderName;
  }

  protected isNetworkFolder(folder: ScanFolder): boolean {
    return folder.path.startsWith('/Volumes/');
  }

  toggleSortMenu() {
    this.sortMenuOpen = !this.sortMenuOpen;
  }

  setSortMode(mode: SortMode) {
    this.sortMode.set(mode);
    this.toggleSortMenu();
    localStorage.setItem(this.LS_SORT, mode);
  }

  readonly sortLabel = computed(() => {
    const value = this.sortMode();

    return (
      this.sortOptions.find(option => option.value === value)?.label
      ?? 'Default'
    );
  });

  openScanFoldersDialog() {
    const ref = this.dialog.open(ScanFoldersDialogComponent, {
      width: '800px',
      maxWidth: '95vw',
    });

    ref.afterClosed().subscribe(result => {
      if (result?.refreshLibrary) {
        void this.refreshLibrary();
      }
    });
  }

  toggleGroup(title: string) {
    this.collapsedGroups.update(current => {
      const next = new Set(current);

      if (next.has(title)) {
        next.delete(title);
      } else {
        next.add(title);
      }

      return next;
    });
  }

  isGroupCollapsed(title: string): boolean {
    return this.collapsedGroups().has(title);
  }

  toggleSearch() {
    this.searchOpen.update(v => !v);
  }

  setSearchQuery(value: string) {
    this.searchQuery.set(value);
  }

  clearSearch() {
    this.searchQuery.set('');
  }

  readonly filteredBooks = computed(() => {
    const query = this.searchQuery().trim().toLowerCase();

    if (!query) return this.books();

    return this.books().filter(book => {
      const title = book.title?.toLowerCase() ?? '';
      const filename = book.filename?.toLowerCase() ?? '';
      const fullPath = book.fullPath?.toLowerCase() ?? '';

      return (
        title.includes(query) ||
        filename.includes(query) ||
        fullPath.includes(query)
      );
    });
  });

  scrollToPreviousPosition(){
    const id = sessionStorage.getItem('djvu.library.lastBookId');

    setTimeout(() => {
      const el = id
        ? document.querySelector(`[data-book-id="${CSS.escape(id)}"]`)
        : null;

      if (el) {
        el.scrollIntoView({ block: 'center' });
        return;
      }

      const y = Number(sessionStorage.getItem('djvu.library.scrollY') || 0);
      window.scrollTo({ top: y });
    });
  }

  protected readonly timestamp = timestamp;

  saveCurrentScrollPosition(book: Book) {
    sessionStorage.setItem('djvu.library.lastBookId', book.id);
    sessionStorage.setItem('djvu.library.scrollY', String(window.scrollY));
  }

  scrollToTop() {
    window.scrollTo({
      top: 0,
      behavior: 'smooth',
    });
  }
}
