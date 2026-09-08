/**
 * RAVEN's curated knowledge data.
 *
 * Why this file exists instead of RAVEN reading `siteConfig` alone: the portfolio's
 * richest text (focus areas, the skill node matrix, per-project architecture/stack
 * notes) currently lives inside UI components, and the brief for this phase forbids
 * touching those components. So the brain keeps its own copy of the *same* strings,
 * and `scripts/check-brain.mjs` fails the build if the two ever drift — the data is
 * duplicated, the truth is not allowed to be.
 *
 * Rules for everything in here:
 *  - Only claims that are already visible on the site, or that describe RAVEN's own
 *    implemented behaviour. Nothing invented: no employers, degrees, clients,
 *    benchmarks, or numbers.
 *  - `glossary` entries are general computer-science explanations, explicitly tagged
 *    `curated`, so an answer can say where the explanation came from.
 *  - Empty contact links stay empty. The absence is the fact.
 */

export type SkillNodeEntry = {
  id: string
  name: string
  category: string
  description: string
}

export type ProjectDetailEntry = {
  architecture: string
  overview: string
  highlights: string[]
  stack: string[]
}

export type GlossaryEntry = {
  id: string
  term: string
  aliases: string[]
  /** One or two sentences a person could read aloud without further context. */
  definition: string
  /** How it shows up in this portfolio, when it does. */
  relevance?: string
  tags: string[]
}

/** Mirrors the "FOCUS CONSTELLATION" list in `app/page.tsx`. */
export const focusAreas = [
  'AI',
  'Agentic AI',
  'Machine Learning',
  'Deep Learning',
  'Data Science',
  'RAG',
  'LLMs',
  'Android',
  'Software Engineering',
  'Data',
  'Automation',
  'Intelligent Systems',
] as const

/** Mirrors `SKILL_NODES` in `components/NeuralGraph.tsx`. */
export const skillNodes: SkillNodeEntry[] = [
  { id: 'ai', name: 'AI Systems', category: 'Core', description: 'Autonomous agentic frameworks, reasoning loops, and model orchestration.' },
  { id: 'agentic', name: 'Agentic AI', category: 'Architecture', description: 'Systems that observe, plan, execute tools, and self-verify outcomes.' },
  { id: 'rag', name: 'RAG Architecture', category: 'Retrieval', description: 'Dense vector retrieval, contextual chunking, and grounded synthesis.' },
  { id: 'ml', name: 'Machine Learning', category: 'Intelligence', description: 'Supervised/unsupervised algorithms, model evaluation, and inference optimization.' },
  { id: 'dl', name: 'Deep Learning', category: 'Neural', description: 'Neural networks, transformer architectures, and embedding representations.' },
  { id: 'ds', name: 'Data Science', category: 'Analytics', description: 'Statistical modeling, signal extraction, and data-driven decision support.' },
  { id: 'vision', name: 'Computer Vision', category: 'Sensing', description: 'Real-time gesture detection, MediaPipe landmark tracking, and image models.' },
  { id: 'android', name: 'Android Engineering', category: 'Mobile', description: 'Performant mobile systems, native integration, and edge intelligence.' },
  { id: 'swe', name: 'Software Engineering', category: 'Systems', description: 'Full-stack architecture, clean code principles, and reliable execution.' },
]

/** Mirrors `getProjectDetails` in `components/ProjectDetailModal.tsx`, keyed by project name. */
export const projectDetails: Record<string, ProjectDetailEntry> = {
  'Akshara Deepa Tutor': {
    architecture: 'Android SDK · On-Device Neural Pipeline · Speech & Script Alignment Engine',
    overview:
      'A specialized educational tool built to bridge linguistic structure and interactive learning feedback for foundational multi-lingual literacy.',
    highlights: [
      'Real-time phonetic feedback and speech-to-symbol mapping.',
      'Offline-first architecture tailored for resource-constrained Android devices.',
      'Adaptive feedback loops to boost engagement and retention.',
    ],
    stack: ['Android', 'Kotlin', 'TensorFlow Lite', 'Edge Speech ML', 'UI/UX Design'],
  },
  'Sign Language Detector': {
    architecture: 'MediaPipe Vision · Custom Landmark Classifier · WebGL Rendering',
    overview: 'A computer vision system that maps complex hand gesture vectors into linguistic tokens in real-time.',
    highlights: [
      '3D hand landmark tracking at 60 FPS with low latency.',
      'Spatial vector normalizer for scale-invariant gesture detection.',
      'Custom gesture dataset trained for high confidence gesture recognition.',
    ],
    stack: ['Computer Vision', 'MediaPipe', 'TypeScript', 'TensorFlow.js', 'Canvas API'],
  },
  'RAG Knowledge Assistant': {
    architecture: 'Hybrid Vector Search · Context Reranker · LLM Orchestration',
    overview:
      'An intelligent retrieval pipeline that converts unstructured enterprise documents into verifiable, grounded context streams.',
    highlights: [
      'Hierarchical document chunking and metadata enrichment.',
      'Hybrid dense-sparse retrieval combining vector similarity with BM25 keyword weighting.',
      'Context reranking layer reducing hallucination rates.',
    ],
    stack: ['Python', 'LangChain / LlamaIndex', 'Vector Databases', 'RAG', 'FastAPI'],
  },
  'Agentic AI Project': {
    architecture: 'ReAct Agentic Loop · Tool Schema Registry · Verification Gatekeepers',
    overview:
      'An autonomous agent system designed to plan multi-step workflows, execute code tools, and self-correct errors prior to output.',
    highlights: [
      'Structured reasoning loops with step-by-step reflection traces.',
      'Dynamic tool calling environment for web, filesystem, and API execution.',
      'Built-in verification boundary ensuring safe, deterministic side-effects.',
    ],
    stack: ['Agentic AI', 'LLM Agents', 'Python', 'AsyncIO', 'JSON Schema Tools'],
  },
  'Data Science Project': {
    architecture: 'Exploratory Data Pipeline · Signal Extraction · Predictive Modeling',
    overview: 'Analytical data framework focused on turning noisy raw event streams into actionable statistical insights.',
    highlights: [
      'Automated feature engineering and anomaly detection.',
      'Statistical modeling for high-dimensional dataset exploration.',
      'Interactive data visualization dashboards.',
    ],
    stack: ['Python', 'Pandas', 'NumPy', 'Scikit-Learn', 'Plotly'],
  },
}

/** How RAVEN describes herself: only what the implemented backend actually does. */
export const ravenSelf = {
  name: 'RAVEN',
  expansion: "Riyan Pasha's Autonomous Virtual Engineering Nexus",
  role: 'A digital engineering companion living inside the portfolio site of Riyan Pasha.',
  summary:
    'RAVEN answers questions about this portfolio from the site data itself, plans multi-step tasks over a small registered tool set, and keeps a persistent memory of useful facts when a database is configured.',
  /** Each line is a capability that exists in code, not an aspiration. */
  capabilities: [
    'Deterministic portfolio knowledge: questions about Riyan, his projects, skills, experiments and sections are answered from the data in this repository.',
    'Optional GenAI: if RAVEN_API_KEY and RAVEN_MODEL are configured, a language provider phrases the answer using only the retrieved portfolio context.',
    'Agentic turns: goal, plan, tool calls, observation, verification, then a concise answer, with a real step budget and per-tool timeouts.',
    'Persistent conversations and memories when DATABASE_URL is set, with a file or in-process fallback for local development.',
    'Voice in and out through the browser Web Speech API; the brain takes text regardless of whether it was typed or spoken.',
  ],
  honestLimits: [
    'No model provider means no open-ended generation: RAVEN answers from local knowledge and says which one it used.',
    'RAVEN has no web access, no filesystem access outside its own data directory, and no shell.',
    'Nothing about Riyan that is not in this repository is known to RAVEN; it will say so instead of guessing.',
  ],
} as const

/** General concepts RAVEN may be asked to explain, tagged so provenance is visible. */
export const glossary: GlossaryEntry[] = [
  {
    id: 'rag',
    term: 'RAG (Retrieval-Augmented Generation)',
    aliases: ['retrieval augmented generation', 'retrieval-augmented generation', 'rag pipeline', 'rag'],
    definition:
      'A pattern where a system first retrieves relevant documents, then asks a model to answer using only that retrieved context. It trades some freedom for grounding: the answer can cite where it came from.',
    relevance: 'Riyan RAG Knowledge Assistant project builds this idea out with hybrid dense-sparse retrieval and a reranking layer.',
    tags: ['retrieval', 'llm', 'architecture'],
  },
  {
    id: 'agentic-ai',
    term: 'Agentic AI',
    aliases: ['agent', 'ai agent', 'agentic', 'agentic system', 'agent loop'],
    definition:
      'A system that takes a goal, plans steps, calls tools, reads the results, and repeats until it can verify an answer — instead of generating one reply in a single pass.',
    relevance:
      'RAVEN backend is an agentic loop of this shape: intent, plan, tool execution, observation, verification, response, with a step budget rather than an unbounded loop.',
    tags: ['agents', 'architecture'],
  },
  {
    id: 'llm',
    term: 'LLM (Large Language Model)',
    aliases: ['llm', 'language model', 'foundation model'],
    definition:
      'A model trained to predict text, which makes it good at phrasing, summarising and following instructions, and unreliable for facts it was not given. Context supplied at query time is what keeps answers honest.',
    tags: ['llm', 'models'],
  },
  {
    id: 'embedding',
    term: 'Embeddings and vector search',
    aliases: ['embedding', 'vector', 'vector database', 'semantic search', 'vector similarity'],
    definition:
      'Text is mapped to a numeric vector so related passages land near each other. Searching by proximity finds paraphrases that keyword matching misses; it is usually combined with a keyword score because proximity alone confuses similar-looking but different claims.',
    relevance: 'Riyan RAG Knowledge Assistant uses hybrid dense-sparse retrieval for exactly this reason.',
    tags: ['retrieval'],
  },
  {
    id: 'hallucination',
    term: 'Hallucination',
    aliases: ['hallucinate', 'hallucinations'],
    definition:
      'Fluent text that is not supported by any source. The practical defences are retrieval with citations, constrained output, and a verification step that refuses an answer it cannot ground.',
    relevance:
      'RAVEN applies a verification gate: claims about this portfolio must match the retrieved record, and when no provider exists, generation is not pretended at all.',
    tags: ['safety', 'llm'],
  },
  {
    id: 'fine-tuning',
    term: 'Fine-tuning',
    aliases: ['fine tune', 'finetuning', 'lora', 'adapter'],
    definition:
      'Continuing training on a narrower dataset to change a model behaviour or style. It is a different tool from retrieval: fine-tuning teaches form, retrieval supplies facts.',
    tags: ['models', 'training'],
  },
  {
    id: 'tool-calling',
    term: 'Tool calling and function schemas',
    aliases: ['function calling', 'tool use', 'tools', 'mcp'],
    definition:
      'The model is given typed function descriptions and asks for calls by name and arguments. A runtime then validates the arguments, enforces permissions and timeouts, executes the call, and returns the observation. The model never executes anything directly.',
    relevance: 'RAVEN tool registry is of this shape: explicit registration, schema validation, allowlisted permissions, per-tool timeout.',
    tags: ['agents', 'safety'],
  },
  {
    id: 'state-machine',
    term: 'State machine',
    aliases: ['state machine', 'states', 'transition'],
    definition:
      'A set of named states plus the transitions that are legal between them. Worth having because it makes "it verified the result" a checkable claim instead of a stylistic one.',
    tags: ['architecture'],
  },
  {
    id: 'bm25',
    term: 'BM25 / lexical scoring',
    aliases: ['bm25', 'tf-idf', 'keyword search', 'lexical search'],
    definition:
      'A keyword ranking function that rewards rare-term matches and penalises very long documents. RAVEN deterministic knowledge layer uses a lexical score of this family, which is why its retrieval is reproducible without a model.',
    tags: ['retrieval'],
  },
  {
    id: 'voice-pipeline',
    term: 'Voice input and output on the web',
    aliases: ['speech to text', 'text to speech', 'stt', 'tts', 'voice', 'asr'],
    definition:
      'In the browser, the Web Speech API can transcribe microphone input and speak replies. It is browser-supplied, so availability varies by engine; a text path always has to remain the primary interface.',
    relevance:
      'RAVEN keeps voice as a transport: the brain receives text, and the mouth-follows-speech driver uses the boundary events the browser actually reports.',
    tags: ['voice', 'browser'],
  },
  {
    id: 'memory',
    term: 'Short-term vs long-term agent memory',
    aliases: ['memory', 'context window', 'session memory'],
    definition:
      'Short-term memory is the recent turns that fit in the context budget. Long-term memory is a filtered store of durable facts, retrieved by relevance when useful. Storing every message is noise; the interesting engineering is the write policy.',
    relevance: 'RAVEN extracts durable facts by rule and importance-score, then only recalls what the current query matches.',
    tags: ['agents', 'memory'],
  },
  {
    id: 'verification',
    term: 'Verification gate',
    aliases: ['verify', 'verification', 'guardrail', 'guard rails'],
    definition:
      'A final check between "an answer exists" and "the answer is claimable": does the output match the retrieved data, does it avoid asserting unobserved side-effects, does it stay inside permissions?',
    tags: ['safety', 'agents'],
  },
]

/** Portfolio sections, so "what is on this page?" is answerable from data. */
export const siteSections = [
  { id: 'hero', title: 'RAVEN stage', note: 'The 3D companion, pointer/vision-driven gaze, and the live model status readout.' },
  { id: 'projects', title: 'Projects', note: 'Five engineering systems with status and technology labels.' },
  { id: 'skills', title: 'Intelligent Node Matrix', note: 'A skill graph: nine nodes across core, retrieval, sensing and systems categories.' },
  { id: 'about', title: 'Who I am', note: 'The about statement plus the focus constellation.' },
  { id: 'contact', title: 'Let us build something intelligent', note: 'Contact links, enabled only when a real URL is configured in siteConfig.' },
] as const
