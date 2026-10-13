import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  Input,
  OnChanges,
  OnDestroy,
  SimpleChanges,
} from '@angular/core';
import { ReaderDocument, TextLayerHandle } from '../../interfaces/reader-document';

@Component({
  selector: 'app-pdf-text-layer',
  standalone: true,
  template: '',
  host: { class: 'reader-text-layer' },
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PdfTextLayerComponent implements OnChanges, OnDestroy {
  @Input({ required: true }) readerDocument!: ReaderDocument;
  @Input({ required: true }) pageNumber!: number;
  @Input({ required: true }) width!: number;
  @Input({ required: true }) height!: number;

  private abortController?: AbortController;
  private handle?: TextLayerHandle;
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

    const renderTextLayer = this.readerDocument.renderTextLayer;
    if (!renderTextLayer || !this.width || !this.height) return;

    const version = ++this.renderVersion;
    const abortController = new AbortController();
    this.abortController = abortController;

    void renderTextLayer.call(this.readerDocument, this.pageNumber, this.host.nativeElement, {
      width: this.width,
      height: this.height,
      signal: abortController.signal,
    }).then(handle => {
      if (version !== this.renderVersion || abortController.signal.aborted) {
        handle?.destroy();
        return;
      }
      this.handle = handle ?? undefined;
      this.host.nativeElement.classList.toggle('has-text', Boolean(handle));
    }).catch(error => {
      if (!abortController.signal.aborted) {
        console.warn(`Unable to render text layer for page ${this.pageNumber}:`, error);
      }
    });
  }

  private destroyLayer(): void {
    this.renderVersion++;
    this.abortController?.abort();
    this.abortController = undefined;
    this.handle?.destroy();
    this.handle = undefined;
    this.host.nativeElement.classList.remove('has-text');
    this.host.nativeElement.replaceChildren();
  }
}
