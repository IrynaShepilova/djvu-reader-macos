export type DocumentFormat = 'pdf' | 'djvu';

export function getDocumentFormat(filename: string): DocumentFormat {
  return filename.toLowerCase().endsWith('.pdf') ? 'pdf' : 'djvu';
}

export function getDocumentFormatIcon(filename: string): string {
  return getDocumentFormat(filename) === 'pdf'
    ? 'assets/images/pdf.svg'
    : 'assets/images/djvu.svg';
}
