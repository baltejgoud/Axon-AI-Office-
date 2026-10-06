import type { AgentMessage } from '../../shared/runtime';
export class AgentMessageBus {
  constructor(
    private messages: AgentMessage[],
    private id: () => string,
    private changed: () => void
  ) {}
  send(input: Omit<AgentMessage, 'messageId' | 'createdAt' | 'status'>) {
    if (input.fromAgentId === input.toAgentId) throw new Error('An agent cannot delegate to itself.');
    const duplicate = this.messages.find(
      (m) =>
        m.runId === input.runId &&
        m.toAgentId === input.toAgentId &&
        m.content === input.content &&
        m.requiresResponse &&
        m.status === 'delivered'
    );
    if (duplicate) throw new Error('This question is already waiting for a response.');
    const message: AgentMessage = {
      ...input,
      messageId: this.id(),
      createdAt: Date.now(),
      status: 'delivered'
    };
    if (input.replyTo) {
      const request = this.messages.find((m) => m.messageId === input.replyTo);
      if (request) request.status = 'answered';
    }
    this.messages.push(message);
    this.changed();
    return message;
  }
  cancel(runId: string) {
    for (const m of this.messages)
      if (m.runId === runId && m.status === 'delivered' && m.requiresResponse) m.status = 'canceled';
    this.changed();
  }
}
