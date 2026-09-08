/**
 * Tool registry: registration, schema validation, permission gating, timeouts,
 * output caps and audit records — all enforced *here*, so no individual tool has to
 * remember any of it and no tool can quietly exceed its limits.
 *
 * Design notes worth defending:
 *  - Timeouts are enforced with a race, not by trusting the handler. A hung tool is
 *    reported as `timeout` and the turn continues.
 *  - Output is truncated to `maxOutputChars` with an explicit marker, because a silent
 *    cut would make a later verification step wrong.
 *  - `action` tools that require approval return `status: 'skipped'` with a clear
 *    reason when the request did not approve them. That is a real, visible outcome —
 *    not an error and not a fake success.
 */
import type { Citation, ToolCall, ToolOutcome, ToolRun, ToolRunStatus, ToolSpec } from '../types'
import { newId } from '../session'

export type ToolContext = {
  sessionId: string
  conversationId: string
  /** Present when persistence is available; tools that need it must handle null. */
  adapter: import('../types').DatabaseAdapter | null
  agentRunId: string | null
  approvedActions: Set<string>
  now: () => string
  config: import('../config').RavenConfig
}

/** An outcome plus the audit record that produced it — `execute` always returns both. */
export type ExecutedTool = ToolOutcome & { run: ToolRun }

export type ToolHandler = (input: Record<string, unknown>, context: ToolContext) => Promise<{ output: unknown; citations?: Citation[]; note?: string }> | { output: unknown; citations?: Citation[]; note?: string }

export type RegisteredTool = {
  spec: ToolSpec
  handler: ToolHandler
  timeoutMs: number
  maxOutputChars: number
}

export type ValidationResult = { ok: true; value: Record<string, unknown> } | { ok: false; errors: string[] }

const typeOf = (value: unknown): string => (Array.isArray(value) ? 'array' : value === null ? 'null' : typeof value)

export function validateToolInput(spec: ToolSpec, raw: unknown, limits: { maxStringChars?: number } = {}): ValidationResult {
  const maxStringChars = limits.maxStringChars ?? 400
  const errors: string[] = []
  if (raw !== null && typeof raw !== 'object') return { ok: false, errors: [`input must be an object, got ${typeOf(raw)}`] }
  const input = { ...(raw as Record<string, unknown>) }
  const declared = new Set(Object.keys(spec.parameters))
  for (const key of Object.keys(input)) {
    if (!declared.has(key)) errors.push(`unknown parameter "${key}"`)
  }
  for (const [key, schema] of Object.entries(spec.parameters)) {
    const value = input[key]
    if (value === undefined || value === null) {
      if (schema.required) errors.push(`missing required parameter "${key}"`)
      continue
    }
    if (typeOf(value) !== schema.type) {
      errors.push(`"${key}" must be ${schema.type}, got ${typeOf(value)}`)
      continue
    }
    if (schema.type === 'string') {
      const text = String(value)
      const max = Math.min(schema.maxLength ?? maxStringChars, maxStringChars)
      if (text.length > max) errors.push(`"${key}" is ${text.length} chars, limit is ${max}`)
      if (schema.minLength && text.length < schema.minLength) errors.push(`"${key}" must be at least ${schema.minLength} chars`)
      if (!text.trim()) errors.push(`"${key}" must not be blank`)
      if (schema.enum && !schema.enum.includes(text)) errors.push(`"${key}" must be one of: ${schema.enum.join(', ')}`)
    }
    if (schema.type === 'number') {
      const number = Number(value)
      if (!Number.isFinite(number)) errors.push(`"${key}" must be a finite number`)
      if (schema.minimum !== undefined && number < schema.minimum) errors.push(`"${key}" must be >= ${schema.minimum}`)
      if (schema.maximum !== undefined && number > schema.maximum) errors.push(`"${key}" must be <= ${schema.maximum}`)
    }
    if (schema.type === 'array') {
      const items = value as unknown[]
      if (schema.maxLength && items.length > schema.maxLength) errors.push(`"${key}" accepts at most ${schema.maxLength} items`)
      if (schema.itemType) {
        for (const item of items) {
          if (typeof item !== schema.itemType) {
            errors.push(`"${key}" items must be ${schema.itemType}`)
            break
          }
        }
      }
    }
    if (schema.enum && schema.type !== 'string') {
      if (!schema.enum.includes(value as string | number | boolean)) errors.push(`"${key}" must be one of: ${schema.enum.join(', ')}`)
    }
  }
  if (errors.length) return { ok: false, errors }
  return { ok: true, value: input }
}

const measure = (value: unknown): number => {
  try {
    return JSON.stringify(value ?? null)?.length ?? 0
  } catch {
    return String(value).length
  }
}

/** Deep-copy through JSON so a handler cannot mutate a shared corpus object. */
const isolate = <T>(value: T): T => {
  try {
    return JSON.parse(JSON.stringify(value)) as T
  } catch {
    return value
  }
}

export type RegistryOptions = {
  defaults?: { timeoutMs?: number; maxOutputChars?: number }
  limits?: { maxStringChars?: number }
  /** Audit sink: the brain writes every run here, the recorder persists it. */
  onRun?: (run: ToolRun) => void
}

export class ToolRegistry {
  private readonly tools = new Map<string, RegisteredTool>()
  private readonly options: RegistryOptions

  // A plain assignment rather than a parameter property: `node --experimental-strip-types`
  // runs the tests, and strip-only mode cannot erase constructor parameter modifiers.
  constructor(options: RegistryOptions = {}) {
    this.options = options
  }

  register(spec: ToolSpec, handler: ToolHandler): this {
    if (this.tools.has(spec.name)) throw new Error(`tool "${spec.name}" is already registered`)
    this.tools.set(spec.name, {
      spec,
      handler,
      timeoutMs: spec.timeoutMs ?? this.options.defaults?.timeoutMs ?? 5000,
      maxOutputChars: this.options.defaults?.maxOutputChars ?? 8000,
    })
    return this
  }

  names(): string[] {
    return [...this.tools.keys()]
  }

  specs(): ToolSpec[] {
    return [...this.tools.values()].map((tool) => tool.spec)
  }

  has(name: string): boolean {
    return this.tools.has(name)
  }

  /** Public so the router can say "no such tool" before a plan is executed. */
  describe(name: string): ToolSpec | null {
    return this.tools.get(name)?.spec ?? null
  }

  async execute(call: ToolCall, context: ToolContext): Promise<ExecutedTool> {
    const started = Date.now()
    const record = (status: ToolRunStatus, extra: { error?: string; output?: unknown; citations?: Citation[]; note?: string }): ToolOutcome & { run: ToolRun } => {
      const ms = Date.now() - started
      const outcome: ToolOutcome = {
        tool: call.tool,
        status,
        ms,
        ...(extra.note ? { note: extra.note } : {}),
        ...(extra.output === undefined ? {} : { output: extra.output }),
        ...(extra.error === undefined ? {} : { error: extra.error }),
        ...(extra.citations === undefined ? {} : { citations: extra.citations }),
      }
      const run: ToolRun = {
        id: newId('toolRun', call.tool),
        toolName: call.tool,
        input: call.input,
        output: status === 'succeeded' ? (extra.output ?? null) : null,
        status,
        ms,
        ...(extra.error === undefined ? {} : { error: extra.error }),
        startedAt: context.now(),
        finishedAt: new Date().toISOString(),
        agentRunId: context.agentRunId,
        conversationId: context.conversationId,
      }
      try {
        this.options.onRun?.(run)
      } catch {
        /* an audit sink must never break a turn */
      }
      return { ...outcome, run }
    }

    const tool = this.tools.get(call.tool)
    if (!tool) return record('rejected', { error: `tool "${call.tool}" is not registered` })

    // The registry, not the tool, decides how big a string parameter may be.
    // The per-turn query budget governs string inputs; the registry's own limit is
    // the fallback for callers that never resolved a config.
    const validated = validateToolInput(tool.spec, call.input, {
      maxStringChars: Math.min(context.config.limits.maxQueryChars, this.options.limits?.maxStringChars ?? context.config.limits.maxQueryChars),
    })
    if (!validated.ok) return record('rejected', { error: validated.errors.join('; ') })

    if (tool.spec.permission === 'action' && tool.spec.requiresApproval && !context.approvedActions.has(tool.spec.name)) {
      return record('skipped', {
        error: `action "${tool.spec.name}" needs explicit approval (send context.approvedActions including "${tool.spec.name}")`,
        output: { proposed: true, tool: tool.spec.name, input: validated.value },
      })
    }

    // A timeout is a race the handler does not know about, so a slow tool can never
    // hold a turn open past its budget.
    let timer: ReturnType<typeof setTimeout> | null = null
    const timeout = new Promise<{ __timedOut: true }>((resolve) => {
      timer = setTimeout(() => resolve({ __timedOut: true }), tool.timeoutMs)
    })
    try {
      const result = await Promise.race([Promise.resolve().then(() => tool.handler(validated.value, context)), timeout])
      if ((result as { __timedOut?: boolean })?.__timedOut) {
        return record('timeout', { error: `tool "${call.tool}" exceeded ${tool.timeoutMs} ms` })
      }
      const payload = isolate((result as { output: unknown }).output)
      const chars = measure(payload)
      const truncated = chars > tool.maxOutputChars
      const output = truncated ? { truncated: true, limitChars: tool.maxOutputChars, preview: JSON.stringify(payload).slice(0, tool.maxOutputChars) } : payload
      if (timer) clearTimeout(timer)
      const citations = (result as { citations?: Citation[] }).citations
      const handlerNote = (result as { note?: string }).note
      return record('succeeded', {
        ...(handlerNote ? { note: handlerNote } : {}),
        output,
        ...(truncated ? { error: `output truncated to ${tool.maxOutputChars} chars` } : {}),
        ...(citations?.length ? { citations } : {}),
      })
    } catch (error) {
      if (timer) clearTimeout(timer)
      const message = (error as Error)?.message ?? String(error)
      return record('failed', { error: `${error instanceof Error ? error.constructor.name : 'Error'}: ${message}`.slice(0, 400) })
    }
  }
}
