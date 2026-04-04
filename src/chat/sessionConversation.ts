interface ConversationTurn {
  user: string;
  assistant: string;
}

export class SessionConversation {
  private turns: ConversationTurn[] = [];

  recordTurn(user: string, assistant: string): void {
    const trimmedUser = user.trim();
    const trimmedAssistant = assistant.trim();
    if (!trimmedUser || !trimmedAssistant) {
      return;
    }

    this.turns.push({ user: trimmedUser, assistant: trimmedAssistant });
  }

  buildContext(options?: { maxTurns?: number; maxChars?: number }): string {
    const maxTurns = normalizeLimit(options?.maxTurns, 6, 1, 20);
    const maxChars = normalizeLimit(options?.maxChars, 2500, 400, 12000);
    const selected = this.turns.slice(-maxTurns);
    if (selected.length === 0) {
      return '';
    }

    const blocks: string[] = [];
    let remainingChars = maxChars;

    for (const turn of selected.reverse()) {
      if (remainingChars <= 0) {
        break;
      }

      const block = [
        `User: ${truncate(turn.user, 500)}`,
        `Assistant: ${truncate(turn.assistant, 700)}`,
      ].join('\n');

      if (block.length > remainingChars) {
        blocks.push(truncate(block, remainingChars));
        break;
      }

      blocks.push(block);
      remainingChars -= block.length + 2;
    }

    return blocks.reverse().join('\n\n');
  }
}

function normalizeLimit(value: number | undefined, fallback: number, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, Math.floor(value)));
}

function truncate(value: string, maxChars: number): string {
  if (value.length <= maxChars) {
    return value;
  }
  if (maxChars <= 1) {
    return value.slice(0, maxChars);
  }
  return value.slice(0, maxChars - 1) + '…';
}