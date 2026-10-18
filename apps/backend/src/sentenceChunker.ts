import { EventEmitter } from "events";

export class SentenceChunker extends EventEmitter {
  private buffer = "";

  push(token: string): void {
    this.buffer += token;
    const boundary = this.buffer.search(/[.?!]\s/);
    if (boundary !== -1 && this.buffer.length > 20) {
      const sentence = this.buffer.slice(0, boundary + 1).trim();
      this.emit("sentence", sentence);
      this.buffer = this.buffer.slice(boundary + 2);
    }
  }

  flush(): void {
    if (this.buffer.trim()) {
      this.emit("sentence", this.buffer.trim());
      this.buffer = "";
    }
  }

  reset(): void {
    this.buffer = "";
    this.removeAllListeners("sentence");
  }
}
