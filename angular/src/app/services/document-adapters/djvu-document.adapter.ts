import { DocumentAdapter, ReaderDocument, RenderedPage, RenderOptions } from '../../interfaces/reader-document';
import { bookLoadErrorFromResponse } from '../../classes/book-load-error';

declare const DjVu: any;

export class DjvuDocumentAdapter implements DocumentAdapter {
  readonly format = 'djvu' as const;

  async load(fileUrl: string): Promise<ReaderDocument> {
    const response = await fetch(fileUrl);

    if (!response.ok) {
      throw await bookLoadErrorFromResponse(response);
    }

    const document = new DjVu.Document(await response.arrayBuffer());
    return new DjvuReaderDocument(document);
  }
}

class DjvuReaderDocument implements ReaderDocument {
  readonly pageCount: number;

  constructor(private readonly document: any) {
    this.pageCount = getPageCount(document);
  }

  async renderPage(pageNumber: number, options: RenderOptions = {}): Promise<RenderedPage> {
    const page = await this.document.getPage(pageNumber);
    const imageData = await page.getImageData();

    const source = document.createElement('canvas');
    source.width = imageData.width;
    source.height = imageData.height;
    source.getContext('2d')!.putImageData(imageData, 0, 0);

    const targetWidth = options.targetWidth ?? imageData.width;
    const scale = targetWidth / imageData.width;
    const targetHeight = Math.max(1, Math.round(imageData.height * scale));

    const canvas = document.createElement('canvas');
    canvas.width = targetWidth;
    canvas.height = targetHeight;

    const context = canvas.getContext('2d')!;
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = 'high';
    context.drawImage(source, 0, 0, targetWidth, targetHeight);

    return {
      index: pageNumber,
      width: targetWidth,
      height: targetHeight,
      blob: await canvasToBlob(canvas, options),
    };
  }

  destroy(): void {}
}

function getPageCount(document: any): number {
  const candidates = [
    () => document.getPagesCount?.(),
    () => document.getPagesQuantity?.(),
    () => document.pagesCount,
    () => document.pages?.length,
  ];

  for (const candidate of candidates) {
    try {
      const value = candidate();
      if (typeof value === 'number' && value > 0) return value;
    } catch {}
  }

  return 1;
}

async function canvasToBlob(canvas: HTMLCanvasElement, options: RenderOptions): Promise<Blob> {
  const blob = await new Promise<Blob | null>(resolve =>
    canvas.toBlob(resolve, options.mimeType ?? 'image/jpeg', options.quality ?? 0.85),
  );

  if (!blob) throw new Error('Failed to render page image');
  return blob;
}
