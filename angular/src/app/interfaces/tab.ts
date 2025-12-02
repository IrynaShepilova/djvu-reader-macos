import {Book} from './book';

export interface Tab {
  id: string;
  title: string;
  book: Book;
  active?: boolean;
}
