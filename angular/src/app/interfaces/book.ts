export interface Book {
  id: string;
  title: string;
  author?: string;
  filename: string;
  url: string;
  cover?: string;
  fullPath?: string;
  isNew?: boolean;
  totalPages?: number | null;
  progressPercent?: number | null;
  createdAt?: string | null;
  lastOpenedAt?: string | null;
  category?: string | null;
  favorite?: boolean;
  hidden?: boolean;
}
