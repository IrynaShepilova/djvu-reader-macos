import { Injectable } from '@angular/core';
import { Book } from '../interfaces/book';
import { DocumentAdapter, ReaderDocument } from '../interfaces/reader-document';
import { DjvuDocumentAdapter } from './document-adapters/djvu-document.adapter';

@Injectable({ providedIn: 'root' })
export class DocumentService {
  private readonly djvuAdapter = new DjvuDocumentAdapter();

  async load(book: Book, fileUrl: string): Promise<ReaderDocument> {
    const adapter = await this.getAdapter(book);
    return adapter.load(fileUrl);
  }

  private async getAdapter(book: Book): Promise<DocumentAdapter> {
    const extension = book.filename.split('.').pop()?.toLowerCase();

    if (extension === 'pdf') {
      const { PdfDocumentAdapter } = await import('./document-adapters/pdf-document.adapter');
      return new PdfDocumentAdapter();
    }

    if (extension === 'djvu' || extension === 'djv') return this.djvuAdapter;

    throw new Error(`Unsupported book format: ${book.filename}`);
  }
}
