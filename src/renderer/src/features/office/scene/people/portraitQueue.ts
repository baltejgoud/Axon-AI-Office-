/**
 * Which portraits to render next. Each person is rendered once; asking again for someone waiting
 * only moves them forward when it is urgent (the person just selected, for example).
 */
export class PortraitQueue {
  private readonly waiting: string[] = [];
  private readonly known = new Set<string>();

  request(id: string, urgent = false): void {
    if (this.known.has(id)) {
      if (!urgent) return;
      const index = this.waiting.indexOf(id);
      if (index > 0) {
        this.waiting.splice(index, 1);
        this.waiting.unshift(id);
      }
      return;
    }
    this.known.add(id);
    if (urgent) this.waiting.unshift(id);
    else this.waiting.push(id);
  }

  /** The next `count` people to render, removed from the queue. */
  take(count: number): string[] {
    return this.waiting.splice(0, count);
  }

  get size(): number {
    return this.waiting.length;
  }
}
