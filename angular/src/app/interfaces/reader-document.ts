export type DocumentFormat = 'djvu' | 'pdf';

export interface RenderOptions {
  targetWidth?: number;
  mimeType?: 'image/jpeg';
  quality?: number;
}

export interface RenderedPage {
  index: number;
  width: number;
  height: number;
  blob: Blob;
}

export interface ReaderDocument {
  readonly pageCount: number;

  renderPage(pageNumber: number, options?: RenderOptions): Promise<RenderedPage>;
  destroy(): void | Promise<void>;
}

export interface DocumentAdapter {
  readonly format: DocumentFormat;

  load(fileUrl: string): Promise<ReaderDocument>;
}
