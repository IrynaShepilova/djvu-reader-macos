import { ReaderDocument } from './reader-document';

export type ReaderLayoutMode = 'single' | 'spread';
export type ReaderFitMode = 'none' | 'width' | 'height';

export interface TabState {
  pages: { index: number; width: number; height: number }[];
  thumbs: { index: number; url: string | null; width?: number; height?: number }[];
  allPages: { index: number; url: string; width: number; height: number }[];
  currentPage: number;
  layoutMode: ReaderLayoutMode;
  fitMode: ReaderFitMode;
  zoom: number;
  textSelectionEnabled: boolean;
  totalPages: number;
  loadingProgress: number;
  loadingDone: boolean;
  document?: ReaderDocument;
  loading?: boolean;
  id?: string;
}

export interface PageImage {
  index: number;
  url: string;
}

export interface ThumbImage {
  index: number;
  url: string | null;
  width?: number;
  height?: number;
}

export interface ReadingPosition {
  page: number;
  offsetRatio: number;
}
