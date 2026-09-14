export class StderrRingBuffer {
  private lines: string[] = [];

  constructor(private readonly maxLines = 25) {}

  push(chunk: string): void {
    const newLines = chunk
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l.length > 0);

    this.lines.push(...newLines);
    if (this.lines.length > this.maxLines) {
      this.lines = this.lines.slice(-this.maxLines);
    }
  }

  getRecentLines(): string[] {
    return [...this.lines];
  }

  getRecentText(): string {
    return this.lines.join("\n");
  }

  clear(): void {
    this.lines = [];
  }
}
