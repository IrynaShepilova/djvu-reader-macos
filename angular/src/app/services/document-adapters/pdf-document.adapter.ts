import { getDocument, GlobalWorkerOptions, type PDFDocumentProxy } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { DocumentAdapter, ReaderDocument, RenderedPage, RenderOptions } from '../../interfaces/reader-document';

GlobalWorkerOptions.workerSrc = new URL('assets/pdf.worker.min.mjs', document.baseURI).toString();

export class PdfDocumentAdapter implements DocumentAdapter {
  readonly format = 'pdf' as const;

  async load(fileUrl: string): Promise<ReaderDocument> {
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

  destroy(): Promise<void> {
    return this.document.destroy();
  }
}
