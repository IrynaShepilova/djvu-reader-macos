import {ChangeDetectionStrategy, Component, Input, OnChanges, OnDestroy, Output, EventEmitter, SimpleChanges} from '@angular/core';
import {DocumentOutlineItem, InternalLinkTarget, ReaderDocument} from '../../interfaces/reader-document';

interface VisibleOutlineItem {
  item: DocumentOutlineItem;
  depth: number;
}

@Component({
  selector: 'app-document-outline',
  standalone: true,
  templateUrl: './document-outline.component.html',
  styleUrl: './document-outline.component.scss',
  changeDetection: ChangeDetectionStrategy.Eager,
})
export class DocumentOutlineComponent implements OnChanges, OnDestroy {
  @Input() readerDocument?: ReaderDocument;
  @Output() internalLink = new EventEmitter<InternalLinkTarget>();

  loading = false;
  error = false;
  items: DocumentOutlineItem[] = [];
  visibleItems: VisibleOutlineItem[] = [];
  private readonly expandedIds = new Set<string>();
  private loadVersion = 0;
  private destinationController?: AbortController;

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['readerDocument']) {
      void this.loadOutline();
    }
  }

  ngOnDestroy(): void {
    this.loadVersion++;
    this.destinationController?.abort();
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
    this.expandedIds.clear();
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
      for (const item of this.items) {
        if (item.children.length) this.expandedIds.add(item.id);
      }
      this.rebuildVisibleItems();
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
  }
}
