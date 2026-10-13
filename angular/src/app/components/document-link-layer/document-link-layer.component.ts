import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  EventEmitter,
  Input,
  OnChanges,
  OnDestroy,
  Output,
  SimpleChanges,
} from '@angular/core';
import {
  InternalLinkTarget,
  LinkLayerHandle,
  ReaderDocument,
} from '../../interfaces/reader-document';

@Component({
  selector: 'app-document-link-layer',
  standalone: true,
  template: '',
  host: { class: 'document-link-layer' },
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DocumentLinkLayerComponent implements OnChanges, OnDestroy {
  @Input({ required: true }) readerDocument!: ReaderDocument;
  @Input({ required: true }) pageNumber!: number;
  @Input({ required: true }) width!: number;
  @Input({ required: true }) height!: number;
  @Output() internalLink = new EventEmitter<InternalLinkTarget>();
  @Output() externalLink = new EventEmitter<string>();

  private abortController?: AbortController;
  private handle?: LinkLayerHandle;
  private renderVersion = 0;

  constructor(private readonly host: ElementRef<HTMLElement>) {}

  ngOnChanges(_changes: SimpleChanges): void {
    this.startRender();
  }

  ngOnDestroy(): void {
    this.destroyLayer();
  }

  private startRender(): void {
    this.destroyLayer();

    const renderLinkLayer = this.readerDocument.renderLinkLayer;
    if (!renderLinkLayer || !this.width || !this.height) return;

    const version = ++this.renderVersion;
    const abortController = new AbortController();
    this.abortController = abortController;

    const externalLinkHandler = window.electronAPI?.openExternalUrl
      ? (url: string) => this.externalLink.emit(url)
      : undefined;
    void renderLinkLayer.call(this.readerDocument, this.pageNumber, this.host.nativeElement, {
      width: this.width,
      height: this.height,
      signal: abortController.signal,
      onInternalLink: target => this.internalLink.emit(target),
      onExternalLink: externalLinkHandler,
    }).then(handle => {
      if (version !== this.renderVersion || abortController.signal.aborted) {
        handle?.destroy();
        return;
      }
      this.handle = handle ?? undefined;
    }).catch(error => {
      if (!abortController.signal.aborted) {
        console.warn(`Unable to render link layer for page ${this.pageNumber}:`, error);
      }
    });
  }

  private destroyLayer(): void {
    this.renderVersion++;
    this.abortController?.abort();
    this.abortController = undefined;
    this.handle?.destroy();
    this.handle = undefined;
    this.host.nativeElement.replaceChildren();
  }
}
