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

export interface InternalLinkTarget {
  page: number;
  offsetRatio: number;
}

export interface DocumentOutlineItem {
  id: string;
  title: string;
  children: DocumentOutlineItem[];
  destinationId?: string;
}

export interface LinkLayerOptions {
  width: number;
  height: number;
  signal: AbortSignal;
  onInternalLink: (target: InternalLinkTarget) => void;
  onExternalLink?: (url: string) => void;
}

export interface LinkLayerHandle {
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
  renderLinkLayer?(
    pageNumber: number,
    container: HTMLElement,
    options: LinkLayerOptions,
  ): Promise<LinkLayerHandle | null>;
  loadOutline?(): Promise<DocumentOutlineItem[] | null>;
  resolveOutlineDestination?(
    destinationId: string,
    signal: AbortSignal,
  ): Promise<InternalLinkTarget | null>;
  destroy(): void | Promise<void>;
}

export interface DocumentAdapter {
  readonly format: DocumentFormat;

  load(fileUrl: string): Promise<ReaderDocument>;
}
