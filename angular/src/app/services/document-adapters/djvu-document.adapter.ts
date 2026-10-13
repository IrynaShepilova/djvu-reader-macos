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

declare const DjVu: any;

interface DjvuTextZone {
  x: number;
  y: number;
  width: number;
  height: number;
  text: string;
}

interface PositionedTextZone extends DjvuTextZone {}

const MAX_TEXT_ZONES = 50_000;

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

  async getPageDimensions(pageNumber: number): Promise<PageDimensions> {
    const page = await this.document.getPage(pageNumber);
    const width = page.getWidth();
    const height = page.getHeight();
    const rotation = page.getRotation?.() ?? 0;

    return rotation === 90 || rotation === 270
      ? { width: height, height: width }
      : { width, height };
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

  async renderTextLayer(
    pageNumber: number,
    container: HTMLElement,
    options: TextLayerOptions,
  ): Promise<TextLayerHandle | null> {
    const page = await this.document.getPage(pageNumber);
    if (options.signal.aborted) return null;

    // These calls parse only the embedded text chunks; unlike getImageData(), they do not decode
    // the page bitmap. Keep them together after getPage() to minimize DjVu.js page resets.
    const text = page.getText();
    const zones = page.getNormalizedTextZones();
    if (options.signal.aborted || !text.trim() || !Array.isArray(zones)) return null;

    const pageWidth = page.getWidth();
    const pageHeight = page.getHeight();
    const rotation = page.getRotation?.() ?? 0;
    if (!isPositiveFinite(pageWidth) || !isPositiveFinite(pageHeight)) return null;

    const rotatedWidth = rotation === 90 || rotation === 270 ? pageHeight : pageWidth;
    const rotatedHeight = rotation === 90 || rotation === 270 ? pageWidth : pageHeight;
    const scaleX = options.width / rotatedWidth;
    const scaleY = options.height / rotatedHeight;
    if (!isPositiveFinite(scaleX) || !isPositiveFinite(scaleY)) return null;

    const positionedZones = zones
      .filter(isDjvuTextZone)
      .map(zone => rotateZone(zone, pageWidth, pageHeight, rotation))
      .filter(zone => intersectsPage(zone, rotatedWidth, rotatedHeight));

    if (
      options.signal.aborted ||
      !positionedZones.length ||
      positionedZones.length > MAX_TEXT_ZONES ||
      !positionedZones.some(zone => zone.text.trim().length > 0)
    ) {
      return null;
    }

    const layerContainer = document.createElement('div');
    layerContainer.className = 'djvu-text-layer-content';
    container.append(layerContainer);

    for (const zone of positionedZones) {
      const span = document.createElement('span');
      span.className = 'djvu-text-zone';
      span.textContent = zone.text;
      span.style.left = `${zone.x * scaleX}px`;
      span.style.top = `${zone.y * scaleY}px`;
      span.style.width = `${zone.width * scaleX}px`;
      span.style.height = `${zone.height * scaleY}px`;
      span.style.fontSize = `${Math.max(1, zone.height * scaleY * 0.85)}px`;
      span.style.lineHeight = `${Math.max(1, zone.height * scaleY)}px`;
      layerContainer.append(span);
    }

    if (options.signal.aborted) {
      layerContainer.remove();
      return null;
    }

    let destroyed = false;
    return {
      destroy: () => {
        if (destroyed) return;
        destroyed = true;
        layerContainer.remove();
      },
    };
  }

  destroy(): void {}
}

function isDjvuTextZone(value: unknown): value is DjvuTextZone {
  if (!value || typeof value !== 'object') return false;

  const zone = value as Partial<DjvuTextZone>;
  return (
    typeof zone.text === 'string' &&
    Number.isFinite(zone.x) &&
    Number.isFinite(zone.y) &&
    isPositiveFinite(zone.width) &&
    isPositiveFinite(zone.height)
  );
}

function isPositiveFinite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

function rotateZone(
  zone: DjvuTextZone,
  pageWidth: number,
  pageHeight: number,
  rotation: number,
): PositionedTextZone {
  // DjVu.js exposes normalized zones in unrotated, bottom-left page coordinates.
  switch (rotation) {
    case 90:
      return {
        ...zone,
        x: zone.y,
        y: zone.x,
        width: zone.height,
        height: zone.width,
      };
    case 180:
      return {
        ...zone,
        x: pageWidth - zone.x - zone.width,
        y: zone.y,
      };
    case 270:
      return {
        ...zone,
        x: pageHeight - zone.y - zone.height,
        y: pageWidth - zone.x - zone.width,
        width: zone.height,
        height: zone.width,
      };
    default:
      return {
        ...zone,
        y: pageHeight - zone.y - zone.height,
      };
  }
}

function intersectsPage(zone: PositionedTextZone, pageWidth: number, pageHeight: number): boolean {
  return (
    zone.x < pageWidth &&
    zone.y < pageHeight &&
    zone.x + zone.width > 0 &&
    zone.y + zone.height > 0
  );
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
