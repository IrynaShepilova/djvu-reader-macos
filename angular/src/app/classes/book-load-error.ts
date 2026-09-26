export class BookLoadError extends Error {
  constructor(
    message: string,
    readonly code?: string,
    readonly volumePath?: string,
  ) {
    super(message);
    this.name = 'BookLoadError';
  }
}

export async function bookLoadErrorFromResponse(response: Response): Promise<BookLoadError> {
  const responseText = await response.text();

  try {
    const body = JSON.parse(responseText);
    return new BookLoadError(body.error || `Failed to load book (${response.status})`, body.code, body.volumePath);
  } catch {
    return new BookLoadError(responseText || `Failed to load book (${response.status})`);
  }
}
