export interface Book {
  id: string;
  title: string;
  filename: string;
  url: string;
  cover?: string;
  fullPath?: string;
  isNew?: boolean;
  totalPages?: number | null;
  progressPercent?: number | null;
}
