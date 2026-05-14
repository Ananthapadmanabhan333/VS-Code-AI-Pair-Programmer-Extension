export class TokenCounter {
  // Approximate token counting without running tiktoken in sync context
  // Average: ~4 chars per token for English/code
  static count(text: string): number {
    if (!text) return 0;
    // More accurate approximation
    const words = text.split(/\s+/).length;
    const chars = text.length;
    // Blend word-based and char-based estimates
    return Math.ceil((words * 1.3 + chars / 4) / 2);
  }

  static truncate(text: string, maxTokens: number): string {
    const estimated = this.count(text);
    if (estimated <= maxTokens) return text;
    const ratio = maxTokens / estimated;
    const charLimit = Math.floor(text.length * ratio);
    return text.slice(0, charLimit) + '\n...(truncated)';
  }
}
