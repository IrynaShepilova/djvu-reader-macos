import { ReadingPosition } from '../interfaces/tabState';

interface HistoryNode {
  position: ReadingPosition;
  prev: HistoryNode | null;
  next: HistoryNode | null;
}

export class ReadingHistory {
  private head: HistoryNode | null = null;
  private current: HistoryNode | null = null;
  private size = 0;

  constructor(
    private readonly maxSize = 30
  ) {}

  push(position: ReadingPosition) {
    if (!this.current) {
      const node = this.createNode(position);

      this.head = node;
      this.current = node;
      this.size = 1;

      return;
    }

    this.truncateForward();

    const node = this.createNode(position);

    node.prev = this.current;
    this.current.next = node;
    this.current = node;

    this.size++;

    if (this.size > this.maxSize) {
      this.removeHead();
    }
  }

  back(): ReadingPosition | null {
    if (!this.current?.prev) return null;

    this.current = this.current.prev;

    return this.current.position;
  }

  forward(): ReadingPosition | null {
    if (!this.current?.next) return null;

    this.current = this.current.next;

    return this.current.position;
  }

  canGoBack(): boolean {
    return !!this.current?.prev;
  }

  canGoForward(): boolean {
    return !!this.current?.next;
  }

  getCurrent(): ReadingPosition | null {
    return this.current?.position ?? null;
  }

  clear() {
    this.head = null;
    this.current = null;
    this.size = 0;
  }

  private createNode(position: ReadingPosition): HistoryNode {
    return {
      position,
      prev: null,
      next: null,
    };
  }

  private truncateForward() {
    if (!this.current?.next) return;

    let node: HistoryNode | null = this.current.next;

    while (node) {
      this.size--;
      node = node.next;
    }

    this.current.next = null;
  }

  private removeHead() {
    if (!this.head) return;

    const next = this.head.next;

    if (next) {
      next.prev = null;
    }

    this.head.next = null;
    this.head = next;

    this.size--;
  }

  get isEmpty(): boolean {
    return this.current === null;
  }

  updateCurrent(position: ReadingPosition) {
    if (!this.current) return;

    this.current.position = position;
  }

  getBackPosition(): ReadingPosition | null {
    return this.current?.prev?.position ?? null;
  }

  getForwardPosition(): ReadingPosition | null {
    return this.current?.next?.position ?? null;
  }
}
