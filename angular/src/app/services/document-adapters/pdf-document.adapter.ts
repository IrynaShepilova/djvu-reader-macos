import {
  AnnotationType,
  getDocument,
  GlobalWorkerOptions,
  TextLayer,
  type PDFDocumentProxy,
} from 'pdfjs-dist/legacy/build/pdf.mjs';
import {
  DocumentAdapter,
  DocumentOutlineItem,
  InternalLinkTarget,
  LinkLayerHandle,
  LinkLayerOptions,
  PageDimensions,
  ReaderDocument,
  RenderedPage,
  RenderOptions,
  TextLayerHandle,
  TextLayerOptions,
} from '../../interfaces/reader-document';
import { bookLoadErrorFromResponse } from '../../classes/book-load-error';

GlobalWorkerOptions.workerSrc = new URL('assets/pdf.worker.min.mjs', document.baseURI).toString();

const MAX_LINK_ANNOTATIONS = 1_000;
const MAX_LINK_REGIONS = 2_000;
const MAX_OUTLINE_ITEMS = 10_000;
const MAX_OUTLINE_DEPTH = 64;

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
  private outlinePromise?: Promise<DocumentOutlineItem[]>;
  private readonly outlineDestinations = new Map<string, unknown>();
  private readonly resolvedOutlineDestinations = new Map<string, InternalLinkTarget | null>();

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

  async renderLinkLayer(
    pageNumber: number,
    container: HTMLElement,
    options: LinkLayerOptions,
  ): Promise<LinkLayerHandle | null> {
    const page = await this.document.getPage(pageNumber);
    if (options.signal.aborted) return null;

    const baseViewport = page.getViewport({ scale: 1 });
    const viewport = page.getViewport({ scale: options.width / baseViewport.width });
    const annotations = await page.getAnnotations({ intent: 'display' });

    if (options.signal.aborted) return null;

    const links = annotations.map(annotation => ({
      annotation,
      externalUrl: getAllowedExternalUrl(annotation.url),
    })).filter(link =>
      link.annotation.annotationType === AnnotationType.LINK &&
      (hasInternalDestination(link.annotation.dest) || link.externalUrl),
    );
    if (!links.length || links.length > MAX_LINK_ANNOTATIONS) return null;

    const layerContainer = document.createElement('div');
    layerContainer.className = 'pdf-link-layer-content';
    const fragment = document.createDocumentFragment();
    let regionCount = 0;

    for (const { annotation, externalUrl } of links) {
      if (options.signal.aborted) return null;

      const regions = getLinkRegions(annotation, viewport);
      if (!regions.length || regionCount + regions.length > MAX_LINK_REGIONS) continue;

      regionCount += regions.length;
      for (const region of regions) {
        if (hasInternalDestination(annotation.dest)) {
          const button = document.createElement('button');
          button.type = 'button';
          button.className = 'pdf-link';
          setLinkRegionStyle(button, region);
          setLinkLabel(button, getLinkLabel(annotation, 'Follow internal link'));
          button.addEventListener('click', event => {
            event.preventDefault();
            event.stopPropagation();
            void this.followInternalDestination(annotation.dest, options);
          });
          fragment.append(button);
          continue;
        }

        if (externalUrl) {
          const anchor = document.createElement('a');
          anchor.className = 'pdf-link';
          anchor.href = externalUrl;
          anchor.target = '_blank';
          anchor.rel = 'noopener noreferrer';
          setLinkRegionStyle(anchor, region);
          setLinkLabel(anchor, getLinkLabel(annotation, `Open external link: ${externalUrl}`));
          if (options.onExternalLink) {
            anchor.addEventListener('click', event => {
              event.preventDefault();
              event.stopPropagation();
              options.onExternalLink?.(externalUrl);
            });
          }
          fragment.append(anchor);
        }
      }
    }

    if (!regionCount || options.signal.aborted) return null;

    layerContainer.append(fragment);
    container.append(layerContainer);

    let destroyed = false;
    return {
      destroy: () => {
        if (destroyed) return;
        destroyed = true;
        layerContainer.remove();
      },
    };
  }

  loadOutline(): Promise<DocumentOutlineItem[]> {
    if (!this.outlinePromise) {
      this.outlinePromise = this.createOutline();
    }
    return this.outlinePromise;
  }

  async resolveOutlineDestination(
    destinationId: string,
    signal: AbortSignal,
  ): Promise<InternalLinkTarget | null> {
    if (this.resolvedOutlineDestinations.has(destinationId)) {
      return this.resolvedOutlineDestinations.get(destinationId) ?? null;
    }

    const destination = this.outlineDestinations.get(destinationId);
    if (destination === undefined || signal.aborted) return null;

    const target = await this.resolveInternalDestination(destination, signal);
    if (!signal.aborted) {
      this.resolvedOutlineDestinations.set(destinationId, target);
    }
    return target;
  }

  private async createOutline(): Promise<DocumentOutlineItem[]> {
    const outline = await this.document.getOutline();
    if (!Array.isArray(outline)) return [];

    let itemCount = 0;
    const normalize = (items: unknown[], depth: number): DocumentOutlineItem[] => {
      if (depth > MAX_OUTLINE_DEPTH || itemCount >= MAX_OUTLINE_ITEMS) return [];

      const result: DocumentOutlineItem[] = [];
      for (const source of items) {
        if (!source || typeof source !== 'object' || itemCount >= MAX_OUTLINE_ITEMS) continue;
        const raw = source as { title?: unknown; dest?: unknown; items?: unknown };
        const id = `pdf-outline-${itemCount++}`;
        const destinationId = hasInternalDestination(raw.dest) ? id : undefined;
        if (destinationId) this.outlineDestinations.set(destinationId, raw.dest);

        result.push({
          id,
          title: typeof raw.title === 'string' ? raw.title : '',
          children: Array.isArray(raw.items) ? normalize(raw.items, depth + 1) : [],
          ...(destinationId ? { destinationId } : {}),
        });
      }
      return result;
    };

    return normalize(outline, 0);
  }

  private async followInternalDestination(destination: unknown, options: LinkLayerOptions): Promise<void> {
    try {
      const target = await this.resolveInternalDestination(destination, options.signal);
      if (target && !options.signal.aborted) {
        options.onInternalLink(target);
      }
    } catch (error) {
      if (!options.signal.aborted) {
        console.warn('Unable to resolve PDF link destination:', error);
      }
    }
  }

  private async resolveInternalDestination(
    destination: unknown,
    signal: AbortSignal,
  ): Promise<InternalLinkTarget | null> {
    const explicitDestination = typeof destination === 'string'
      ? await this.document.getDestination(destination)
      : destination;
    if (signal.aborted || !isExplicitDestination(explicitDestination)) return null;

    const pageReference = explicitDestination[0];
    const pageNumber = typeof pageReference === 'number'
      ? pageReference + 1
      : await this.document.getPageIndex(pageReference as any) + 1;
    if (signal.aborted || pageNumber < 1 || pageNumber > this.pageCount) return null;

    const targetPage = await this.document.getPage(pageNumber);
    if (signal.aborted) return null;

    return {
      page: pageNumber,
      offsetRatio: getDestinationOffsetRatio(
        explicitDestination,
        targetPage.getViewport({ scale: 1 }),
      ),
    };
  }

  destroy(): Promise<void> {
    return this.document.destroy();
  }
}

interface LinkRegion {
  left: number;
  top: number;
  width: number;
  height: number;
}

function hasInternalDestination(destination: unknown): boolean {
  return (typeof destination === 'string' && destination.length > 0) || isExplicitDestination(destination);
}

function isExplicitDestination(destination: unknown): destination is unknown[] {
  return Array.isArray(destination) && destination.length >= 2;
}

function getLinkRegions(annotation: any, viewport: any): LinkRegion[] {
  const quadPoints = annotation.quadPoints;
  if (isFiniteNumberArray(quadPoints) && quadPoints.length >= 8 && quadPoints.length % 8 === 0) {
    const points = Array.from(quadPoints);
    const regions: LinkRegion[] = [];
    for (let index = 0; index < points.length; index += 8) {
      const region = getRegionFromPoints(points.slice(index, index + 8), viewport);
      if (region) regions.push(region);
    }
    return regions;
  }

  return isFiniteNumberArray(annotation.rect) && annotation.rect.length === 4
    ? [getRegionFromRectangle(Array.from(annotation.rect), viewport)]
      .filter((region): region is LinkRegion => Boolean(region))
    : [];
}

function getRegionFromPoints(points: number[], viewport: any): LinkRegion | null {
  const viewportPoints: number[][] = [];
  for (let index = 0; index < points.length; index += 2) {
    viewportPoints.push(viewport.convertToViewportPoint(points[index], points[index + 1]));
  }

  return getClippedRegion(
    Math.min(...viewportPoints.map(point => point[0])),
    Math.min(...viewportPoints.map(point => point[1])),
    Math.max(...viewportPoints.map(point => point[0])),
    Math.max(...viewportPoints.map(point => point[1])),
    viewport,
  );
}

function getRegionFromRectangle(rectangle: number[], viewport: any): LinkRegion | null {
  const [x1, y1, x2, y2] = viewport.convertToViewportRectangle(rectangle);
  return getClippedRegion(x1, y1, x2, y2, viewport);
}

function getClippedRegion(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  viewport: any,
): LinkRegion | null {
  if (![x1, y1, x2, y2, viewport.width, viewport.height].every(Number.isFinite)) return null;

  const left = Math.max(0, Math.min(x1, x2));
  const top = Math.max(0, Math.min(y1, y2));
  const right = Math.min(viewport.width, Math.max(x1, x2));
  const bottom = Math.min(viewport.height, Math.max(y1, y2));
  const width = right - left;
  const height = bottom - top;

  return width > 0 && height > 0 ? { left, top, width, height } : null;
}

function getLinkLabel(annotation: any, fallback: string): string {
  const label = annotation.contentsObj?.str ?? annotation.contents ?? annotation.title ?? annotation.overlaidText;
  return typeof label === 'string' && label.trim() ? label.trim() : fallback;
}

function getAllowedExternalUrl(value: unknown): string | null {
  if (typeof value !== 'string') return null;

  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : null;
  } catch {
    return null;
  }
}

function setLinkRegionStyle(element: HTMLElement, region: LinkRegion): void {
  element.style.left = `${region.left}px`;
  element.style.top = `${region.top}px`;
  element.style.width = `${region.width}px`;
  element.style.height = `${region.height}px`;
}

function setLinkLabel(element: HTMLElement, label: string): void {
  element.setAttribute('aria-label', label);
  element.title = label;
}

function getDestinationOffsetRatio(destination: unknown[], viewport: any): number {
  const modeValue = destination[1] as { name?: unknown } | undefined;
  const mode = typeof modeValue?.name === 'string' ? modeValue.name : undefined;
  const view = viewport.view;
  if (!Array.isArray(view) || view.length !== 4 || !Number.isFinite(viewport.height) || viewport.height <= 0) {
    return 0;
  }

  let top: number;
  switch (mode) {
    case 'XYZ':
      top = getViewportY(viewport, finiteOr(destination[2], view[0]), finiteOr(destination[3], view[3]));
      break;
    case 'FitH':
    case 'FitBH':
      top = getViewportY(viewport, view[0], finiteOr(destination[2], view[3]));
      break;
    case 'FitR': {
      if (![destination[2], destination[3], destination[4], destination[5]].every(Number.isFinite)) return 0;
      const [x1, y1, x2, y2] = viewport.convertToViewportRectangle(destination.slice(2, 6));
      top = Math.min(y1, y2);
      break;
    }
    case 'Fit':
    case 'FitB':
    case 'FitV':
    case 'FitBV':
    default:
      return 0;
  }

  return Math.max(0, Math.min(1, top / viewport.height));
}

function getViewportY(viewport: any, x: number, y: number): number {
  const point = viewport.convertToViewportPoint(x, y);
  return Number.isFinite(point[1]) ? point[1] : 0;
}

function finiteOr(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function isFiniteNumberArray(value: unknown): value is ArrayLike<number> {
  return (
    (Array.isArray(value) || ArrayBuffer.isView(value)) &&
    Array.from(value as ArrayLike<unknown>).every(item => typeof item === 'number' && Number.isFinite(item))
  );
}
