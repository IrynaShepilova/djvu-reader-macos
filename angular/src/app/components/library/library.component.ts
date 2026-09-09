import {
  Component,
  computed,
  OnInit,
  OnDestroy,
  signal,
  ElementRef,
  HostListener,
  inject,
  Signal,
  ChangeDetectionStrategy
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
import { ScanFolder } from '../../interfaces/scan-folder';
import { ScanFoldersService } from '../../services/scan-folders.service';
import { ScanFoldersDialogComponent } from '../scan-folders-dialog/scan-folders-dialog.component';
import { BookService } from '../../services/book.service';
import { ScanFoldersFacade } from '../../services/scan-folders-facade';
import { BookCardComponent } from '../book-card/book-card.component';
import { MatIcon } from '@angular/material/icon';
import {LibraryToolbarComponent} from '../library-toolbar/library-toolbar.component';
import { EditBookDialogComponent } from '../edit-book-dialog/edit-book-dialog.component';
import { firstValueFrom } from 'rxjs';
import { forkJoin } from 'rxjs';
import {MissingBooksDialogComponent} from '../missing-books-dialog/missing-books-dialog.component';
import {NgTemplateOutlet} from '@angular/common';

type LibraryViewMode = 'tile' | 'list';
type SortMode = 'default' | 'lastOpened' | 'dateAdded' | 'byDirectory' | 'title' | 'category';

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
    NgTemplateOutlet,
  ],
  templateUrl: './library.component.html',
  changeDetection: ChangeDetectionStrategy.Eager,
  styleUrl: './library.component.scss'
})
export class LibraryComponent implements OnInit, OnDestroy {

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

  showHidden = signal(false);

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
    { value: 'dateAdded' as SortMode, label: 'Date Added' },
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
  private readonly LS_LIBRARY_SEARCH = 'djvu.library.searchQuery.v1';

  showScrollTop = signal(false);

  private removeOpenFileListener?: () => void;
  private removeOpenFilesListener?: () => void;

  @HostListener('window:scroll')
  onWindowScroll() {
    this.showScrollTop.set(window.scrollY > window.innerHeight);
  }

  async ngOnInit() {

    this.removeOpenFileListener = window.electronAPI?.onOpenFile?.((filePath) => {
      void this.openBookFromFilePath(filePath);
    });

    this.removeOpenFilesListener = window.electronAPI?.onOpenFiles?.((filePaths) => {
      void this.handleOpenFiles(filePaths);
    });

    window.electronAPI?.rendererReady?.();

    const list = await this.loadBooks();
    this.books.set(this.enrichBooks(list));

    this.restoreLibraryState();

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
          const url = await this.bookService.buildPreview(b);
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
    this.restoreLibraryState();
  }

  async checkLibrary() {
    const result = await this.bookService.getMissingBooks().toPromise();

    if (!result) return;

    if (!result.count) {
      this.dialog.open(DialogComponent, {
        width: '420px',
        data: {
          title: 'Library check',
          message: 'All books are available.',
        },
      });

      return;
    }

    const ref = this.dialog.open(MissingBooksDialogComponent, {
      width: '600px',
      data: {
        books: result.books,
      },
    });

    ref.afterClosed().subscribe(action => {
      if (action === 'hide') {
        forkJoin(
          result.books.map(book => this.bookService.hideBook(book.id))
        ).subscribe(() => {
          void this.refreshLibrary();
        });
      }

      if (action === 'remove') {
        forkJoin(
          result.books.map(book => this.bookService.deleteBook(book.id))
        ).subscribe(() => {
          void this.refreshLibrary();
        });
      }
    });
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

    const groups = [...map.values()];

    for (const group of groups) {
      group.books.sort(this.compareByTitle);
      group.books.sort(this.compareFavoritesFirst);
    }

    return groups.sort((a, b) => {
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
        list.sort(this.compareByLastOpened);
        break;

      case 'dateAdded':
        list.sort(this.compareByDateAdded);
        break;

      case 'title':
        list.sort(this.compareByTitle);
        break;

      case 'category':
        list.sort(this.compareByCategory);
        break;

      case 'default':
      default:
        break;
    }

    return list.sort(this.compareFavoritesFirst);
  }

  private compareByLastOpened = (a: Book, b: Book): number => {
    const aTime = a.lastOpenedAt ? new Date(a.lastOpenedAt).getTime() : 0;
    const bTime = b.lastOpenedAt ? new Date(b.lastOpenedAt).getTime() : 0;
    return bTime - aTime;
  };

  private compareByDateAdded = (a: Book, b: Book): number => {
    const aTime = a.createdAt ? new Date(a.createdAt).getTime() : 0;
    const bTime = b.createdAt ? new Date(b.createdAt).getTime() : 0;
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

  private compareFavoritesFirst = (a: Book, b: Book): number => {
    return Number(!!b.favorite) - Number(!!a.favorite);
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

  private normalizeForSearch(value: string): string {
    return value
      .normalize('NFC')
      .toLowerCase()
      .trim();
  }

  readonly filteredBooks = computed(() => {
    const query = this.normalizeForSearch(this.searchQuery());

    if (!query) return this.books();

    return this.books().filter(book => {
      const title = this.normalizeForSearch(book.title ?? '');
      const filename = this.normalizeForSearch(book.filename ?? '');
      const fullPath = this.normalizeForSearch(book.fullPath ?? '');

      return (
        title.includes(query) ||
        filename.includes(query) ||
        fullPath.includes(query)
      );
    });
  });

  restoreSearchQuery(){
    const savedSearch = sessionStorage.getItem(this.LS_LIBRARY_SEARCH);

    if (savedSearch !== null) {
      this.searchQuery.set(savedSearch);
      this.searchOpen.set(!!savedSearch);
    }
  }

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

  private restoreLibraryState() {
    this.restoreSearchQuery();

    setTimeout(() => {
      this.scrollToPreviousPosition();
    });
  }

  saveCurrentScrollPosition(book: Book) {
    sessionStorage.setItem('djvu.library.lastBookId', book.id);
    sessionStorage.setItem('djvu.library.scrollY', String(window.scrollY));
    sessionStorage.setItem(this.LS_LIBRARY_SEARCH, this.searchQuery());
  }

  scrollToTop() {
    window.scrollTo({
      top: 0,
      behavior: 'smooth',
    });
  }

  async toggleFavorite(book: Book) {
    const nextFavorite = !book.favorite;

    try {
      const res = await this.bookService
        .updateBookMeta(book.id, { favorite: nextFavorite })
        .toPromise();

      if (!res?.book) return;

      this.books.update(books =>
        books.map(b => b.id === book.id ? { ...b, favorite: res.book.favorite } : b)
      );
    } catch (e) {
      console.error('Failed to update favorite', e);
    }
  }

  openEditBookDialog(book: Book) {
    const ref = this.dialog.open(EditBookDialogComponent, {
      width: '800px',
      maxWidth: '95vw',
      height: '600px',
      data: {
        book,
        coverUrl: this.previewMap()[book.id],
      }
    });

    ref.afterClosed().subscribe(result => {
      if (!result) return;

      if (result.patch) {
        void this.updateBookMeta(result.book.id, result.patch);
      }

      if (result.coverFile) {
        void this.updateBookCover(result.book.id, result.coverFile);
      }

      if (result.removeCover) {
         this.removeBookCover(result.book);
      }

    });
  }

  async updateBookMeta(id: string, patch: Partial<Book>) {
    try {
      const res = await this.bookService
        .updateBookMeta(id, patch)
        .toPromise();

      if (!res?.book) return;

      this.books.update(books =>
        books.map(book =>
          book.id === id ? { ...book, ...res.book } : book
        )
      );
    } catch (e) {
      console.error('Failed to update book meta', e);
    }
  }

  async updateBookCover(id: string, file: File) {
    try {
      const res = await this.bookService
        .uploadCover(id, file)
        .toPromise();

      if (!res?.coverUrl) return;

      this.books.update(books =>
        books.map(book =>
          book.id === id
            ? { ...book, cover: res.coverUrl }
            : book
        )
      );

      this.previewMap.update(map => ({
        ...map,
        [id]: `${this.apiBase}${res.coverUrl}?t=${Date.now()}`,
      }));

    } catch (e) {
      console.error('Failed to update cover', e);
    }
  }

  async removeBookCover(book: Book) {
    try {
      await this.bookService.deleteCover(book.id).toPromise();

      const bookWithoutCover = {
        ...book,
        cover: '',
      };

      this.books.update(books =>
        books.map( b =>
          b.id === book.id ? bookWithoutCover : b
        )
      );

      this.previewCache.delete(book.id);

      const previewUrl = await this.bookService.buildPreview(bookWithoutCover);

      this.previewCache.set(book.id, previewUrl);
      this.previewMap.update(map => ({
        ...map,
        [book.id]: previewUrl,
      }));
    } catch (e) {
      console.error('Failed to remove cover', e);
    }
  }

  async openBookFromFilePath(filePath: string) {
    let book = this.books().find(b => b.fullPath === filePath);

    if (!book) {
      await firstValueFrom(
        this.bookService.addBookByPath(filePath)
      );
      console.log('response', book);

      await this.refreshLibrary();

      book = this.books().find(b => b.fullPath === filePath);
      console.log('book',book );
    }

    if (book) {
      this.openBook(book);
    }
  }

  async handleOpenFiles(filePaths: string[]) {
    if (filePaths.length === 1) {
      await this.openBookFromFilePath(filePaths[0]);
      return;
    }

    let added = 0;

    for (const filePath of filePaths) {
      const exists = this.books().some(b => b.fullPath === filePath);

      if (!exists) {
        await firstValueFrom(
          this.bookService.addBookByPath(filePath)
        );

        added++;
      }
    }

    await this.refreshLibrary();

    this.dialog.open(DialogComponent, {
      width: '420px',
      data: {
        title: 'Books added',
        message:
          added === 0
            ? 'No books added: all selected books are already in the library.'
            : `Added ${added} of ${filePaths.length} selected books.`,
      },
    });
  }

  toggleBookHidden(book: Book) {
    this.bookService.updateBookMeta(book.id, {
      hidden: !book.hidden,
    }).subscribe({
      next: () => {
        void this.refreshLibrary();
      },
      error: (e) => {
        console.error('Failed to update book visibility', e);
      },
    });
  }

  removeBook(book: Book) {
    const ref = this.dialog.open(DialogComponent, {
      width: '420px',
      data: {
        title: 'Remove book',
        message: `Remove "${book.title}" from the library?`,
        okText: 'Remove',
        cancelText: 'Cancel',
      },
    });

    ref.afterClosed().subscribe(confirmed => {
      if (!confirmed) return;

      this.bookService.deleteBook(book.id).subscribe({
        next: () => {
          void this.refreshLibrary();
        },
        error: (e) => {
          console.error('Failed to remove book', e);
        },
      });
    });
  }

  ngOnDestroy() {
    this.removeOpenFileListener?.();
    this.removeOpenFilesListener?.();
  }

}
