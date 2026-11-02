/**
 * Tool permissions and approval gates.
 *
 * RAVEN currently exposes only read-only knowledge lookup. Nothing in this
 * code path can write, execute shell commands, call other services or spend
 * money. Any tool that would change state must declare `requiresApproval`
 * and is denied by the gate below until a human approves it.
 */

export type ToolMode = 'read' | 'write'

export type ToolPermission = {
  id: string
  mode: ToolMode
  requiresApproval: boolean
  description: string
}

export const DEFAULT_TOOLS: readonly ToolPermission[] = [
  {
    id: 'knowledge.lookup',
    mode: 'read',
    requiresApproval: false,
    description: 'Reads the local portfolio knowledge base in data/siteConfig.ts.',
  },
]

export type Authorization =
  | { allowed: true; tool: ToolPermission }
  | { allowed: false; code: 'TOOL_UNKNOWN' | 'APPROVAL_REQUIRED'; message: string }

export function authorizeTool(
  toolId: string,
  tools: readonly ToolPermission[] = DEFAULT_TOOLS,
): Authorization {
  const tool = tools.find((candidate) => candidate.id === toolId)

  if (!tool) {
    return {
      allowed: false,
      code: 'TOOL_UNKNOWN',
      message: `Tool "${toolId}" is not registered, so RAVEN will not run it.`,
    }
  }

  if (tool.requiresApproval || tool.mode === 'write') {
    return {
      allowed: false,
      code: 'APPROVAL_REQUIRED',
      message: `Tool "${toolId}" changes state and needs explicit approval before it can run.`,
    }
  }

  return { allowed: true, tool }
}
