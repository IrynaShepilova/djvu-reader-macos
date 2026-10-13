import {
  getDocument,
  GlobalWorkerOptions,
  TextLayer,
  type PDFDocumentProxy,
} from 'pdfjs-dist/legacy/build/pdf.mjs';
import {
  DocumentAdapter,
  PageDimensions,
  ReaderDocument,
  RenderedPage,
  RenderOptions,
  TextLayerHandle,
  TextLayerOptions,
} from '../../interfaces/reader-document';
import { bookLoadErrorFromResponse } from '../../classes/book-load-error';

GlobalWorkerOptions.workerSrc = new URL('assets/pdf.worker.min.mjs', document.baseURI).toString();

export class PdfDocumentAdapter implements DocumentAdapter {
  readonly format = 'pdf' as const;

  async load(fileUrl: string): Promise<ReaderDocument> {
    const response = await fetch(fileUrl, { headers: { Range: 'bytes=0-0' } });

    if (!response.ok) {
      throw await bookLoadErrorFromResponse(response);
    }

    const loadingTask = getDocument(fileUrl);
    const document = await loadingTask.promise;
    return new PdfReaderDocument(document);
  }
}

class PdfReaderDocument implements ReaderDocument {
  readonly pageCount: number;

  constructor(private readonly document: PDFDocumentProxy) {
    this.pageCount = document.numPages;
  }

  async getPageDimensions(pageNumber: number): Promise<PageDimensions> {
    const page = await this.document.getPage(pageNumber);
    const viewport = page.getViewport({ scale: 4 });

    return {
      width: Math.max(1, Math.round(viewport.width)),
      height: Math.max(1, Math.round(viewport.height)),
    };
  }

  async renderPage(pageNumber: number, options: RenderOptions = {}): Promise<RenderedPage> {
    const page = await this.document.getPage(pageNumber);
    const defaultRenderScale = 4;
    const baseViewport = page.getViewport({ scale: defaultRenderScale });
    const targetWidth = options.targetWidth ?? Math.round(baseViewport.width);
    const scale = targetWidth / baseViewport.width;
    const viewport = page.getViewport({ scale: defaultRenderScale * scale });

    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(viewport.width));
    canvas.height = Math.max(1, Math.round(viewport.height));

    const context = canvas.getContext('2d')!;
    await page.render({ canvas, canvasContext: context, viewport }).promise;

    const blob = await new Promise<Blob | null>(resolve =>
      canvas.toBlob(resolve, options.mimeType ?? 'image/png', options.quality ?? 1),
    );

    if (!blob) throw new Error('Failed to render page image');

    return {
      index: pageNumber,
      width: canvas.width,
      height: canvas.height,
      blob,
    };
  }

  async renderTextLayer(
    pageNumber: number,
    container: HTMLElement,
    options: TextLayerOptions,
  ): Promise<TextLayerHandle | null> {
    const page = await this.document.getPage(pageNumber);
    if (options.signal.aborted) return null;

    const baseViewport = page.getViewport({ scale: 1 });
    const viewport = page.getViewport({ scale: options.width / baseViewport.width });
    const textContent = await page.getTextContent();

    if (
      options.signal.aborted ||
      !textContent.items.some(item => 'str' in item && item.str.trim().length > 0)
    ) {
      return null;
    }

    const layerContainer = document.createElement('div');
    layerContainer.className = 'pdf-text-layer-content';
    layerContainer.style.setProperty('--total-scale-factor', String(viewport.scale));
    container.append(layerContainer);

    const textLayer = new TextLayer({
      textContentSource: textContent,
      container: layerContainer,
      viewport,
    });

    let destroyed = false;
    const destroy = () => {
      if (destroyed) return;
      destroyed = true;
      textLayer.cancel();
      layerContainer.remove();
    };
    const onAbort = () => destroy();

    options.signal.addEventListener('abort', onAbort, { once: true });
    try {
      await textLayer.render();
    } catch (error) {
      destroy();
      if (options.signal.aborted) return null;
      throw error;
    } finally {
      options.signal.removeEventListener('abort', onAbort);
    }

    if (options.signal.aborted) {
      destroy();
      return null;
    }

    return { destroy };
  }

  destroy(): Promise<void> {
    return this.document.destroy();
  }
}
