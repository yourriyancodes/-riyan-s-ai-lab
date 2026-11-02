import { PROMPT_LEAK_SENTINEL } from './prompt'
import { RAVEN_MAX_OUTPUT_CHARS } from './types'

/**
 * Verification gate. Runs after the model answers and before anything is shown
 * to the user. Keeps the previous "verify before speaking" behaviour honest:
 * a failing answer is reported as an error instead of being displayed.
 */

export type VerificationIssue =
  | 'EMPTY_OUTPUT'
  | 'OUTPUT_TOO_LONG'
  | 'PROMPT_LEAK'
  | 'SECRET_PATTERN'

export type VerificationResult =
  | { ok: true; output: string }
  | { ok: false; issue: VerificationIssue; message: string }

const SECRET_PATTERNS: RegExp[] = [
  /\bAIza[0-9A-Za-z_-]{35}\b/, // Google API key
  /\bsk-[A-Za-z0-9]{20,}\b/, // OpenAI-style key
  /\bgh[pousr]_[A-Za-z0-9]{20,}\b/, // GitHub token
]

export function verifyOutput(output: string): VerificationResult {
  const cleaned = stripWrappingNoise(output)

  if (!cleaned) {
    return { ok: false, issue: 'EMPTY_OUTPUT', message: 'The provider returned no usable text.' }
  }

  if (cleaned.length > RAVEN_MAX_OUTPUT_CHARS) {
    return {
      ok: false,
      issue: 'OUTPUT_TOO_LONG',
      message: `The provider returned more than ${RAVEN_MAX_OUTPUT_CHARS} characters.`,
    }
  }

  if (cleaned.includes(PROMPT_LEAK_SENTINEL)) {
    return {
      ok: false,
      issue: 'PROMPT_LEAK',
      message: 'The provider echoed internal instructions, so the answer was rejected.',
    }
  }

  if (SECRET_PATTERNS.some((pattern) => pattern.test(cleaned))) {
    return {
      ok: false,
      issue: 'SECRET_PATTERN',
      message: 'The answer looked like it contained a credential, so it was rejected.',
    }
  }

  return { ok: true, output: cleaned }
}

function stripWrappingNoise(value: string): string {
  let text = value.replace(/\r\n/g, '\n').trim()

  // Remove a single pair of wrapping quotes some models add.
  if (text.length > 1) {
    const first = text[0]
    const last = text[text.length - 1]
    if ((first === '"' || first === "'") && last === first) {
      text = text.slice(1, -1).trim()
    }
  }

  return text
}
