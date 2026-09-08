/**
 * The action agent: the only place a turn can change anything.
 *
 * Two kinds of action exist, and they are treated differently on purpose.
 *  - Writing a memory is performed when the user asked for it in so many words
 *    ("remember that …"), because that request *is* the permission.
 *  - Moving the page is proposed, never performed unilaterally: the server cannot
 *    scroll a browser anyway, so it emits a `ProposedAction` and the client decides.
 *
 * Every action goes through the tool registry, so each one has a schema-validated
 * record in `tool_runs` whether it succeeded, was refused, or was never approved.
 */
import type { MemoryUpdate, ProposedAction, ToolRun } from '../types'
import { newId } from '../session'
import type { ToolContext, ToolRegistry } from '../tools/registry'

export type ActionInput = {
  registry: ToolRegistry
  context: ToolContext
  updates: MemoryUpdate[]
  navigation: { section: string } | null
  maxActions?: number
}

export type ActionResult = {
  actions: ProposedAction[]
  runs: ToolRun[]
  stored: number
  expired: number
  errors: string[]
  navigation: { section: string; approved: boolean; targetPresent: boolean } | null
}

const statusToAction = (status: ToolRun['status']): ProposedAction['status'] =>
  status === 'succeeded' ? 'executed' : status === 'skipped' ? 'proposed' : status === 'rejected' ? 'rejected' : 'failed'

export async function runActions(input: ActionInput): Promise<ActionResult> {
  const actions: ProposedAction[] = []
  const runs: ToolRun[] = []
  const errors: string[] = []
  let stored = 0
  let expired = 0
  const max = input.maxActions ?? 4

  const perform = async (tool: string, args: Record<string, unknown>, note: string): Promise<{ ok: boolean; output: unknown }> => {
    if (!input.registry.has(tool)) {
      errors.push(`${tool}: not registered`)
      return { ok: false, output: null }
    }
    const outcome = await input.registry.execute({ tool, input: args }, input.context)
    runs.push(outcome.run)
    actions.push({
      id: newId('toolRun', `action-${tool}`),
      tool,
      input: args,
      status: statusToAction(outcome.status),
      result: outcome.output ?? null,
      ...(outcome.error ? { note: `${note} — ${outcome.error}` } : { note }),
    })
    return { ok: outcome.status === 'succeeded', output: outcome.output ?? null }
  }

  for (const update of input.updates.slice(0, max)) {
    if (update.op === 'expire') {
      const result = await perform('forget_fact', { key: update.key }, update.reason)
      const output = result.output as { removed?: boolean } | null
      if (result.ok && output?.removed) expired++
      continue
    }
    const result = await perform(
      'remember_fact',
      { key: update.key, value: update.value ?? '', ...(update.importance === undefined ? {} : { importance: update.importance }) },
      update.reason,
    )
    const output = result.output as { persisted?: boolean; driver?: string } | null
    if (result.ok && output?.persisted) stored++
    else if (result.ok) errors.push('remember_fact ran but reported nothing persisted')
    else if (!errors.some((error) => error.startsWith('remember_fact'))) errors.push(`remember_fact did not persist: ${update.key}`)
  }

  let navigation: ActionResult['navigation'] = null
  if (input.navigation) {
    const result = await perform('request_navigation', { section: input.navigation.section }, 'user asked to move the page')
    const output = (result.output ?? {}) as { approved?: boolean; targetPresent?: boolean; executed?: boolean }
    navigation = {
      section: input.navigation.section,
      // `executed` stays false: a server cannot scroll a browser. The client's own
      // action handler flips it when it actually moves the page.
      approved: Boolean(output.approved),
      targetPresent: output.targetPresent !== false,
    }
  }

  return { actions, runs, stored, expired, errors, navigation }
}
