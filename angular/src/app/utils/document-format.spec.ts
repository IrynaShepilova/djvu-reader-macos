import { describe, expect, it } from 'vitest';

import { getDocumentFormat, getDocumentFormatIcon } from './document-format';

describe('document format', () => {
  it('identifies PDF files and their icon', () => {
    expect(getDocumentFormat('book.PDF')).toBe('pdf');
    expect(getDocumentFormatIcon('book.PDF')).toBe('assets/images/pdf.svg');
  });

  it('identifies DjVu files and their icon', () => {
    expect(getDocumentFormat('book.djvu')).toBe('djvu');
    expect(getDocumentFormatIcon('book.djvu')).toBe('assets/images/djvu.svg');
  });
});
