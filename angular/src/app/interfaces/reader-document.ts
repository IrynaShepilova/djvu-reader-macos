export type DocumentFormat = 'djvu' | 'pdf';

export interface RenderOptions {
  targetWidth?: number;
  mimeType?: 'image/jpeg' | 'image/png';
  quality?: number;
}

export interface RenderedPage {
  index: number;
  width: number;
  height: number;
  blob: Blob;
}

export interface PageDimensions {
  width: number;
  height: number;
}

export interface TextLayerOptions {
  width: number;
  height: number;
  signal: AbortSignal;
}

export interface TextLayerHandle {
  destroy(): void;
}

export interface ReaderDocument {
  readonly pageCount: number;

  getPageDimensions(pageNumber: number): Promise<PageDimensions>;
  renderPage(pageNumber: number, options?: RenderOptions): Promise<RenderedPage>;
  renderTextLayer?(
    pageNumber: number,
    container: HTMLElement,
    options: TextLayerOptions,
  ): Promise<TextLayerHandle | null>;
  destroy(): void | Promise<void>;
}

export interface DocumentAdapter {
  readonly format: DocumentFormat;

  load(fileUrl: string): Promise<ReaderDocument>;
}
