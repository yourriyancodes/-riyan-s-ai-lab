/**
 * In-process fallback store: the last resort, and the one unit tests run against.
 *
 * It is intentionally honest about being ephemeral — `status().detail` says so, the
 * console can show it, and nothing pretends a restart preserved anything.
 */
import type {
  AgentRunRecord,
  ConversationMessageRecord,
  ConversationRecord,
  DatabaseAdapter,
  DatabaseStatus,
  MemoryRecord,
  ToolRun,
} from '../types'

export type MemoryStoreRows = {
  conversations: ConversationRecord[]
  messages: ConversationMessageRecord[]
  memories: MemoryRecord[]
  agentRuns: AgentRunRecord[]
  toolRuns: ToolRun[]
}

export function createMemoryDatabase(
  detail = 'in-process store (data is lost when the process exits)',
  /** Optionally adopt externally owned arrays, so a wrapper can load/persist them. */
  external?: MemoryStoreRows,
): DatabaseAdapter & { rows(): MemoryStoreRows } {
  const rows: MemoryStoreRows = external ?? { conversations: [], messages: [], memories: [], agentRuns: [], toolRuns: [] }
  const byId = <T extends { id: string }>(list: T[], id: string) => list.find((entry) => entry.id === id)

  return {
    rows: () => rows,
    status: (): DatabaseStatus => ({ driver: 'memory', configured: false, reachable: true, detail }),
    async ensureSchema() {
      /* nothing to create */
    },
    async upsertConversation(conversation) {
      const existing = byId(rows.conversations, conversation.id)
      if (existing) Object.assign(existing, conversation)
      else rows.conversations.unshift({ ...conversation })
    },
    async appendMessage(message) {
      rows.messages.push({ ...message })
      const conversation = byId(rows.conversations, message.conversationId)
      if (conversation) conversation.updatedAt = message.createdAt
    },
    async recentMessages(conversationId, limit) {
      return rows.messages.filter((message) => message.conversationId === conversationId).slice(-limit)
    },
    async listConversations(sessionId, limit) {
      return rows.conversations.filter((conversation) => conversation.sessionId === sessionId).slice(0, limit)
    },
    async remember(memory) {
      const existing = rows.memories.find((entry) => entry.sessionId === memory.sessionId && entry.key === memory.key)
      if (existing) Object.assign(existing, memory, { createdAt: existing.createdAt, updatedAt: memory.updatedAt })
      else rows.memories.unshift({ ...memory })
    },
    async recallMemories(sessionId, limit) {
      return rows.memories.filter((memory) => memory.sessionId === sessionId).sort((a, b) => b.importance - a.importance).slice(0, limit)
    },
    async searchMemories(sessionId, terms, limit) {
      const needles = terms.map((term) => term.toLowerCase()).filter(Boolean)
      if (!needles.length) return []
      return rows.memories
        .filter((memory) => memory.sessionId === sessionId)
        .map((memory) => {
          const haystack = `${memory.key} ${memory.value}`.toLowerCase()
          const score = needles.reduce((total, term) => (haystack.includes(term) ? total + 1 : total), 0)
          return { memory, score }
        })
        .filter((entry) => entry.score > 0)
        .sort((a, b) => b.score - a.score || b.memory.importance - a.memory.importance)
        .slice(0, limit)
        .map((entry) => entry.memory)
    },
    async expireMemory(sessionId, key) {
      const index = rows.memories.findIndex((memory) => memory.sessionId === sessionId && memory.key === key)
      if (index < 0) return false
      rows.memories.splice(index, 1)
      return true
    },
    async startAgentRun(run) {
      rows.agentRuns.unshift({ ...run })
    },
    async finishAgentRun(run) {
      const existing = byId(rows.agentRuns, run.id)
      if (existing) Object.assign(existing, run)
      else rows.agentRuns.unshift({ ...run })
    },
    async recordToolRun(run) {
      rows.toolRuns.push({ ...run })
    },
  }
}
