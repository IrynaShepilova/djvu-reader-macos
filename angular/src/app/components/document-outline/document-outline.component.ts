import {ChangeDetectionStrategy, Component, Input, OnChanges, OnDestroy, Output, EventEmitter, SimpleChanges} from '@angular/core';
import {DocumentOutlineItem, InternalLinkTarget, ReaderDocument} from '../../interfaces/reader-document';

interface VisibleOutlineItem {
  item: DocumentOutlineItem;
  depth: number;
}

const OUTLINE_DESTINATION_CONCURRENCY = 4;

@Component({
  selector: 'app-document-outline',
  standalone: true,
  templateUrl: './document-outline.component.html',
  styleUrl: './document-outline.component.scss',
  changeDetection: ChangeDetectionStrategy.Eager,
})
export class DocumentOutlineComponent implements OnChanges, OnDestroy {
  @Input() readerDocument?: ReaderDocument;
  @Input() active = false;
  @Input() currentPage = 1;
  @Output() internalLink = new EventEmitter<InternalLinkTarget>();

  loading = false;
  error = false;
  items: DocumentOutlineItem[] = [];
  visibleItems: VisibleOutlineItem[] = [];
  private readonly expandedIds = new Set<string>();
  private readonly itemById = new Map<string, DocumentOutlineItem>();
  private readonly itemIdByDestinationId = new Map<string, string>();
  private readonly parentById = new Map<string, string>();
  private readonly destinationPages = new Map<string, number>();
  private loadVersion = 0;
  private destinationController?: AbortController;
  private pageResolutionController?: AbortController;
  private loadedDocument?: ReaderDocument;
  highlightedItemId?: string;

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['currentPage']) this.updateHighlight();

    if (!this.active) {
      if (changes['readerDocument']) this.resetOutline();
      return;
    }

    if (
      (changes['readerDocument'] || changes['active']) &&
      (this.loadedDocument !== this.readerDocument || !this.items.length)
    ) {
      void this.loadOutline();
    }
  }

  ngOnDestroy(): void {
    this.loadVersion++;
    this.destinationController?.abort();
    this.pageResolutionController?.abort();
  }

  hasChildren(item: DocumentOutlineItem): boolean {
    return item.children.length > 0;
  }

  isExpanded(item: DocumentOutlineItem): boolean {
    return this.expandedIds.has(item.id);
  }

  toggle(item: DocumentOutlineItem): void {
    if (!this.hasChildren(item)) return;
    if (this.expandedIds.has(item.id)) {
      this.expandedIds.delete(item.id);
    } else {
      this.expandedIds.add(item.id);
    }
    this.rebuildVisibleItems();
  }

  activate(item: DocumentOutlineItem): void {
    const document = this.readerDocument;
    if (!item.destinationId || !document?.resolveOutlineDestination) return;

    this.destinationController?.abort();
    const controller = new AbortController();
    this.destinationController = controller;
    const resolveDestination = document.resolveOutlineDestination;

    void resolveDestination.call(document, item.destinationId, controller.signal)
      .then(target => {
        if (target && !controller.signal.aborted && document === this.readerDocument) {
          this.internalLink.emit(target);
        }
      })
      .catch(error => {
        if (!controller.signal.aborted) {
          console.warn('Unable to resolve document outline destination:', error);
        }
      });
  }

  private async loadOutline(): Promise<void> {
    const document = this.readerDocument;
    const version = ++this.loadVersion;
    this.destinationController?.abort();
    this.pageResolutionController?.abort();
    this.expandedIds.clear();
    this.itemById.clear();
    this.itemIdByDestinationId.clear();
    this.parentById.clear();
    this.destinationPages.clear();
    this.loadedDocument = undefined;
    this.highlightedItemId = undefined;
    this.items = [];
    this.visibleItems = [];
    this.error = false;

    if (!document?.loadOutline) {
      this.loading = false;
      return;
    }

    this.loading = true;
    try {
      const items = await document.loadOutline();
      if (version !== this.loadVersion || document !== this.readerDocument) return;

      this.items = items ?? [];
      this.loadedDocument = document;
      this.indexOutlineItems(this.items);
      for (const item of this.items) {
        if (item.children.length) this.expandedIds.add(item.id);
      }
      this.rebuildVisibleItems();
      void this.resolveDestinationPages(document, version);
    } catch (error) {
      if (version !== this.loadVersion || document !== this.readerDocument) return;
      this.error = true;
      console.warn('Unable to load document outline:', error);
    } finally {
      if (version === this.loadVersion && document === this.readerDocument) {
        this.loading = false;
      }
    }
  }

  private resetOutline(): void {
    this.loadVersion++;
    this.destinationController?.abort();
    this.pageResolutionController?.abort();
    this.expandedIds.clear();
    this.itemById.clear();
    this.itemIdByDestinationId.clear();
    this.parentById.clear();
    this.destinationPages.clear();
    this.loadedDocument = undefined;
    this.highlightedItemId = undefined;
    this.loading = false;
    this.error = false;
    this.items = [];
    this.visibleItems = [];
  }

  private rebuildVisibleItems(): void {
    const visible: VisibleOutlineItem[] = [];
    const visit = (items: DocumentOutlineItem[], depth: number) => {
      for (const item of items) {
        visible.push({item, depth});
        if (item.children.length && this.expandedIds.has(item.id)) {
          visit(item.children, depth + 1);
        }
      }
    };
    visit(this.items, 0);
    this.visibleItems = visible;
    this.updateHighlight();
  }

  private indexOutlineItems(items: DocumentOutlineItem[], parentId?: string): void {
    for (const item of items) {
      this.itemById.set(item.id, item);
      if (item.destinationId) this.itemIdByDestinationId.set(item.destinationId, item.id);
      if (parentId) this.parentById.set(item.id, parentId);
      this.indexOutlineItems(item.children, item.id);
    }
  }

  private async resolveDestinationPages(document: ReaderDocument, version: number): Promise<void> {
    const resolveDestination = document.resolveOutlineDestination;
    if (!resolveDestination) return;

    this.pageResolutionController?.abort();
    const controller = new AbortController();
    this.pageResolutionController = controller;
    const destinationIds = Array.from(this.itemById.values())
      .map(item => item.destinationId)
      .filter((id): id is string => Boolean(id));
    let nextIndex = 0;

    const resolveNext = async (): Promise<void> => {
      while (!controller.signal.aborted) {
        const destinationId = destinationIds[nextIndex++];
        if (!destinationId) return;

        try {
          const target = await resolveDestination.call(document, destinationId, controller.signal);
          if (
            target &&
            !controller.signal.aborted &&
            version === this.loadVersion &&
            document === this.readerDocument
          ) {
            this.destinationPages.set(destinationId, target.page);
            this.updateHighlight();
          }
        } catch {
          // Unsupported or malformed destinations are intentionally ignored.
        }
      }
    };

    await Promise.all(Array.from(
      {length: Math.min(OUTLINE_DESTINATION_CONCURRENCY, destinationIds.length)},
      () => resolveNext(),
    ));
  }

  private updateHighlight(): void {
    let activeId: string | undefined;
    let activePage = -1;
    for (const item of this.itemById.values()) {
      const destinationId = item.destinationId;
      if (!destinationId) continue;
      const page = this.destinationPages.get(destinationId);
      if (page === undefined) continue;
      if (page <= this.currentPage && page >= activePage) {
        activeId = destinationId;
        activePage = page;
      }
    }

    if (!activeId) {
      this.highlightedItemId = undefined;
      return;
    }

    const visibleIds = new Set(this.visibleItems.map(row => row.item.id));
    let highlightedId = this.itemIdByDestinationId.get(activeId);
    while (highlightedId && !visibleIds.has(highlightedId)) {
      highlightedId = this.parentById.get(highlightedId);
    }
    this.highlightedItemId = highlightedId;
  }
}
