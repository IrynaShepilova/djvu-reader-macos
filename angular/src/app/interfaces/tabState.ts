export interface TabState {
  pages: { index: number; url: string }[];
  thumbs: { index: number; url: string }[];
  allPages: { index: number; url: string; width: number; height: number }[];
  currentPage: number;
  totalPages: number;
  loadingProgress: number;
  loadingDone: boolean;
  document?: any;
  loading?: boolean;
  id?: string;
}

export interface PageImage {
  index: number;
  url: string;
}

export interface ThumbImage {
  index: number;
  url: string;
}
