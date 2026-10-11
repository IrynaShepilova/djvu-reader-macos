import { ReaderDocument } from './reader-document';

export interface TabState {
  pages: { index: number; width: number; height: number }[];
  thumbs: { index: number; url: string | null; width?: number; height?: number }[];
  allPages: { index: number; url: string; width: number; height: number }[];
  currentPage: number;
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
