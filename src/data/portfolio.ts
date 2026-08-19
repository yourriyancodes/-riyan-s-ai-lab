// ============================================================================
//  RIYAN PASHA · PORTFOLIO DATA — single source of truth for the whole site.
//  Everything the site shows comes from this file (and knowledge.ts).
//  Items marked [PLACEHOLDER] are waiting for your real information.
//  The AI assistant can ONLY answer from the content defined here.
// ============================================================================

// ---------------------------------------------------------------------------
//  IDENTITY — TECH KING: a technologist across worlds, not one title
// ---------------------------------------------------------------------------

export type WorldId =
  | 'ai'
  | 'data'
  | 'software'
  | 'mobile'
  | 'web'
  | 'cloud'
  | 'automation'
  | 'experiments'

export const WORLD_HUES: Record<WorldId, string> = {
  ai: '#4ef0b8',
  data: '#9db2ff',
  software: '#ffa06a',
  mobile: '#7fe8a8',
  web: '#6fc4f0',
  cloud: '#8fa3b8',
  automation: '#b8e06e',
  experiments: '#c9a8f0',
}

export const profile = {
  name: 'Riyan Pasha',
  brand: 'TECH KING',
  identity: 'Technologist · Builder · Problem Solver',
  specialty: 'AI Product Engineer', // ONE specialty inside a larger ecosystem
  status: 'BUILDING ACROSS TECHNOLOGY',
  heroFormula: ['AI', 'DATA', 'SOFTWARE', 'PRODUCTS', 'EXPERIMENTATION'],
  tagline: 'Building across technology, from intelligent systems to real-world products.',
  coreMessage: "I don't belong to one technology. I build across technology.",
  contact: {
    email: 'you@example.com', // [PLACEHOLDER] — replace with your email
    github: 'https://github.com/your-github', // [PLACEHOLDER] — replace with your GitHub URL
    linkedin: 'https://linkedin.com/in/your-handle', // [PLACEHOLDER] — replace with your LinkedIn URL
  },
}

// ---------------------------------------------------------------------------
//  THE TECH UNIVERSE — eight worlds around the core
// ---------------------------------------------------------------------------

export interface World {
  id: WorldId
  index: string
  title: string
  tagline: string
  blurb: string
  domains: string[]
}

export const worlds: World[] = [
  {
    id: 'ai',
    index: '01',
    title: 'ARTIFICIAL INTELLIGENCE',
    tagline: 'Intelligent systems',
    blurb:
      'Machine learning, deep learning, generative AI, RAG, agents and computer vision. One of Riyan\u2019s strongest domains — but only one world in the universe.',
    domains: ['Machine Learning', 'Deep Learning', 'Generative AI', 'RAG', 'AI Agents', 'Computer Vision', 'NLP', 'Reinforcement Learning'],
  },
  {
    id: 'data',
    index: '02',
    title: 'DATA',
    tagline: 'From raw to insight',
    blurb:
      'Data science and data engineering — exploration, pipelines, analysis and visualisation that turn raw data into decisions.',
    domains: ['Data Science', 'Data Engineering', 'EDA', 'Pandas', 'Visualization', 'Analytics'],
  },
  {
    id: 'software',
    index: '03',
    title: 'SOFTWARE',
    tagline: 'Systems that hold together',
    blurb:
      'Software engineering, backend services, APIs and developer tools — the engineering discipline behind every product.',
    domains: ['Software Engineering', 'Backend Development', 'APIs', 'Python', 'Developer Tools'],
  },
  {
    id: 'mobile',
    index: '04',
    title: 'MOBILE',
    tagline: 'Products in your pocket',
    blurb:
      'Native Android development with Kotlin and Jetpack Compose — intelligent products that run on the devices people carry.',
    domains: ['Android', 'Kotlin', 'Jetpack Compose', 'Mobile Applications'],
  },
  {
    id: 'web',
    index: '05',
    title: 'WEB',
    tagline: 'Interactive frontends',
    blurb:
      'Web development and interactive frontends — including this very website, built as a 3D experience.',
    domains: ['Web Development', 'React', 'Frontend Engineering', '3D / WebGL'],
  },
  {
    id: 'cloud',
    index: '06',
    title: 'CLOUD',
    tagline: 'Deploy · scale · operate',
    blurb:
      'Cloud platforms and infrastructure — shipping, scaling and operating systems beyond the laptop.',
    domains: ['Cloud Platforms', 'Deployment', 'Infrastructure', 'Scaling'],
  },
  {
    id: 'automation',
    index: '07',
    title: 'AUTOMATION',
    tagline: 'Work that runs itself',
    blurb:
      'Automation and workflows — scripts, pipelines and AI-powered systems that remove repetitive work.',
    domains: ['Automation', 'Workflows', 'Scripting', 'AI Automation'],
  },
  {
    id: 'experiments',
    index: '08',
    title: 'EXPERIMENTS',
    tagline: 'Ideas in progress',
    blurb:
      'Prototypes, experiments and emerging technologies — the sandbox where the next capability is born.',
    domains: ['Emerging Technologies', 'Prototypes', 'R&D', 'Exploration'],
  },
]

/** AI Product Engineering = the intersection of three worlds — a capability, not a boundary. */
export const intersection = {
  formula: ['AI', 'DATA', 'SOFTWARE'],
  result: 'AI PRODUCT ENGINEERING',
  note: "AI Product Engineering isn't the boundary of who Riyan is — it's the intersection of three worlds he moves between.",
}

// ---------------------------------------------------------------------------
//  ABOUT
// ---------------------------------------------------------------------------

export const about = {
  intro:
    'Riyan Pasha is a technologist and builder who moves across AI, data, software, mobile, web, cloud and automation. He designs intelligent systems, engineers the software around them, and ships products people actually use.',
  detail:
    'Comfortable moving between code, data, AI, applications, systems and experiments — and quick to pick up whatever a problem requires. AI is one of his strongest domains; it is not the entirety of his identity. [PLACEHOLDER — add one or two sentences about your background or journey.]',
  tags: ['AI', 'ML', 'GENAI', 'RAG', 'AGENTS', 'DATA', 'SOFTWARE', 'MOBILE', 'WEB', 'CLOUD', 'AUTOMATION', 'BUILD'],
}

// ---------------------------------------------------------------------------
//  SKILLS — the interconnected constellation (nodes colored by world)
// ---------------------------------------------------------------------------

export interface Skill {
  id: string
  name: string
  world: WorldId
  desc: string
}

export const skills: Skill[] = [
  { id: 'ai', name: 'Artificial Intelligence', world: 'ai', desc: 'Designing intelligent systems that perceive, reason and act on real problems.' },
  { id: 'ml', name: 'Machine Learning', world: 'ai', desc: 'Models that learn patterns from data — from classical algorithms to modern pipelines.' },
  { id: 'dl', name: 'Deep Learning', world: 'ai', desc: 'Neural architectures for vision, language and sequence problems.' },
  { id: 'genai', name: 'Generative AI', world: 'ai', desc: 'Systems that create — text, code, images and structured output.' },
  { id: 'llm', name: 'LLMs', world: 'ai', desc: 'Large language models — prompting, evaluation and integration.' },
  { id: 'rag', name: 'RAG', world: 'ai', desc: 'Retrieval-augmented generation — grounding LLM answers in a knowledge base.' },
  { id: 'agents', name: 'AI Agents', world: 'ai', desc: 'Autonomous workflows that plan, call tools and execute multi-step tasks.' },
  { id: 'nlp', name: 'NLP', world: 'ai', desc: 'Language understanding and generation for real-world text systems.' },
  { id: 'cv', name: 'Computer Vision', world: 'ai', desc: 'Teaching machines to see — image processing, detection and recognition.' },
  { id: 'rl', name: 'Reinforcement Learning', world: 'ai', desc: 'Agents that learn decisions through reward-driven experience.' },
  { id: 'aipe', name: 'AI Product Engineering', world: 'ai', desc: 'Where AI, data and software meet — building AI products end to end. One specialty, not the boundary.' },
  { id: 'ds', name: 'Data Science', world: 'data', desc: 'Turning raw data into insight — EDA, statistics and storytelling with numbers.' },
  { id: 'de', name: 'Data Engineering', world: 'data', desc: 'Pipelines that move, clean and serve data at scale.' },
  { id: 'pandas', name: 'Pandas', world: 'data', desc: 'Fast, expressive data manipulation in Python.' },
  { id: 'eda', name: 'EDA', world: 'data', desc: 'Exploratory analysis — finding the signal hiding in the noise.' },
  { id: 'viz', name: 'Visualization', world: 'data', desc: 'Charts and dashboards that make findings legible.' },
  { id: 'se', name: 'Software Engineering', world: 'software', desc: 'Clean, maintainable systems — architecture, quality and delivery.' },
  { id: 'backend', name: 'Backend Development', world: 'software', desc: 'Services, logic and data layers behind the interface.' },
  { id: 'api', name: 'APIs', world: 'software', desc: 'Contracts that let systems talk to each other.' },
  { id: 'python', name: 'Python', world: 'software', desc: 'The language that spans AI, data and automation.' },
  { id: 'devtools', name: 'Developer Tools', world: 'software', desc: 'Tooling that makes building faster and safer.' },
  { id: 'android', name: 'Android', world: 'mobile', desc: 'Native Android product development with modern architecture.' },
  { id: 'kotlin', name: 'Kotlin', world: 'mobile', desc: 'Concise, safe, modern — the language behind Android products.' },
  { id: 'react', name: 'React', world: 'web', desc: 'Interactive interfaces — like this website.' },
  { id: 'webdev', name: 'Web Development', world: 'web', desc: 'Frontends, experiences and the craft of the web.' },
  { id: 'cloud', name: 'Cloud', world: 'cloud', desc: 'Deploying and operating systems beyond the laptop.' },
  { id: 'automation', name: 'Automation', world: 'automation', desc: 'Removing repetitive work with scripts, workflows and AI.' },
  { id: 'emerging', name: 'Emerging Technologies', world: 'experiments', desc: 'The next capabilities — learned fast, tested early.' },
]

// ---------------------------------------------------------------------------
//  PROJECTS — the holographic gallery + case studies
// ---------------------------------------------------------------------------

export interface ProjectLayer {
  label: string
  sub: string
}

export interface Project {
  id: string
  index: string
  title: string
  category: string
  tagline: string
  tech: string[]
  problem: string[]
  approach: string[]
  architecture: string[]
  technology: string[]
  implementation: string[]
  results: string[]
  demo: string // [PLACEHOLDER] — link
  source: string // [PLACEHOLDER] — link
  pipeline: ProjectLayer[]
}

export const projects: Project[] = [
  {
    id: 'akshara-deepa-tutor',
    index: '01',
    title: 'AKSHARA DEEPA TUTOR',
    category: 'AI + ANDROID + EDUCATION',
    tagline: 'An AI-powered Android tutor built with Kotlin, Jetpack Compose and Generative AI.',
    tech: ['Kotlin', 'Jetpack Compose', 'MVVM', 'Generative AI'],
    problem: [
      'Quality learning support is not equally accessible to every student.',
      'This product explores AI-powered tutoring on Android — meeting learners on the device they already carry. [PLACEHOLDER — describe the specific problem you set out to solve.]',
    ],
    approach: [
      'Ship the tutor as a native Android product so it feels fast, offline-capable and personal.',
      'Use a clean MVVM architecture so the generative AI layer stays swappable and testable.',
      'Jetpack Compose drives a modern, responsive learning interface. [PLACEHOLDER — add your approach details.]',
    ],
    architecture: [
      'The app follows MVVM: UI state in ViewModels, data flowing from the generative AI layer through repositories.',
      'The Generative AI component is isolated behind an interface — prompt construction, response parsing and fallbacks live in one module.',
      '[PLACEHOLDER — describe your architecture decisions.]',
    ],
    technology: [
      'Kotlin — the core language of the Android app.',
      'Jetpack Compose — reactive, declarative UI.',
      'MVVM — separation of UI, state and data.',
      'Generative AI — the tutoring intelligence layer.',
    ],
    implementation: [
      'UI layer in Jetpack Compose, driven by ViewModel state.',
      'Repository pattern mediating between the app and the AI backend.',
      'Prompt engineering and response handling for tutoring interactions.',
      '[PLACEHOLDER — describe implementation details, libraries, APIs used.]',
    ],
    results: ['[PLACEHOLDER — add your outcomes: metrics, user feedback, learnings.]'],
    demo: '[PLACEHOLDER — demo link]',
    source: '[PLACEHOLDER — source code link]',
    pipeline: [
      { label: 'USER', sub: 'STUDENT' },
      { label: 'APPLICATION', sub: 'ANDROID · KOTLIN · COMPOSE' },
      { label: 'AI / ML MODEL', sub: 'GENERATIVE AI' },
      { label: 'DATA / KNOWLEDGE', sub: 'LEARNING CONTENT' },
      { label: 'OUTPUT', sub: 'TUTORING EXPERIENCE' },
    ],
  },
  {
    id: 'sign-language-detector',
    index: '02',
    title: 'SIGN LANGUAGE DETECTOR',
    category: 'COMPUTER VISION + MACHINE LEARNING',
    tagline: 'Recognising sign language gestures with Python, computer vision and machine learning.',
    tech: ['Python', 'Machine Learning', 'Computer Vision', 'Image Processing'],
    problem: [
      'Sign language is a full natural language — yet automated recognition tools remain scarce.',
      'This project explores real-time gesture recognition built on classical image processing and machine learning in Python. [PLACEHOLDER — describe the specific problem or dataset you targeted.]',
    ],
    approach: [
      'Pipeline-first: capture frames → preprocess → extract features → classify.',
      'Image processing techniques normalise lighting, noise and background before modelling.',
      'Start with classical ML on engineered features; iterate toward richer vision techniques.',
    ],
    architecture: [
      'Input frames flow through a preprocessing stage (resize, colour-space, filtering).',
      'Feature extraction converts frames into compact representations for the classifier.',
      'The ML model maps features to sign predictions with confidence scores.',
    ],
    technology: [
      'Python — the end-to-end implementation language.',
      'Computer Vision — OpenCV-class image processing.',
      'Machine Learning — classification models.',
      'Image Processing — normalisation and feature engineering.',
    ],
    implementation: [
      'Built a modular preprocessing pipeline for robust frame ingestion.',
      'Engineered features from processed frames and trained classifiers on them.',
      '[PLACEHOLDER — add libraries, model choices, accuracy details.]',
    ],
    results: ['[PLACEHOLDER — add your outcomes: accuracy, classes covered, learnings.]'],
    demo: '[PLACEHOLDER — demo link]',
    source: '[PLACEHOLDER — source code link]',
    pipeline: [
      { label: 'USER', sub: 'GESTURE INPUT' },
      { label: 'APPLICATION', sub: 'PYTHON PIPELINE' },
      { label: 'AI / ML MODEL', sub: 'CV + ML CLASSIFIER' },
      { label: 'DATA / KNOWLEDGE', sub: 'IMAGE PROCESSING' },
      { label: 'OUTPUT', sub: 'SIGN PREDICTION' },
    ],
  },
  {
    id: 'rag-knowledge-assistant',
    index: '03',
    title: 'RAG KNOWLEDGE ASSISTANT',
    category: 'GENERATIVE AI + RAG',
    tagline: 'An LLM assistant that answers from your documents — grounded, cited and hallucination-resistant.',
    tech: ['LLMs', 'Embeddings', 'Vector Search', 'RAG', 'Document Processing'],
    problem: [
      'LLMs hallucinate when they lack grounded context.',
      'The RAG Knowledge Assistant anchors every answer in your own documents: chunk → embed → retrieve → generate with sources. [PLACEHOLDER — describe the knowledge domain you targeted.]',
    ],
    approach: [
      'Documents are processed into chunks with meaningful boundaries and metadata.',
      'Embeddings map chunks into a vector space for similarity search.',
      'The LLM generates answers conditioned on retrieved chunks — every response traces back to source material.',
    ],
    architecture: [
      'Document Processing: ingestion, cleaning, chunking, metadata extraction.',
      'Embedding & Index: vectors written to a searchable store.',
      'Retrieval: query embedding → top-k similar chunks.',
      'Generation: LLM synthesises a cited answer from the retrieved context.',
    ],
    technology: [
      'LLMs — the generation layer.',
      'Embeddings — semantic representation of text.',
      'Vector Search — similarity retrieval over the knowledge base.',
      'Document Processing — chunking and ingestion.',
    ],
    implementation: [
      'Built the ingestion pipeline: parse → clean → chunk → embed → index.',
      'Implemented retrieval with scoring and relevance filtering.',
      'Prompt design enforces grounded, cited answers.',
      '[PLACEHOLDER — add libraries, vector store, model choices.]',
    ],
    results: ['[PLACEHOLDER — add your outcomes: retrieval quality, answer accuracy, learnings.]'],
    demo: '[PLACEHOLDER — demo link]',
    source: '[PLACEHOLDER — source code link]',
    pipeline: [
      { label: 'USER', sub: 'QUERY' },
      { label: 'APPLICATION', sub: 'RAG PIPELINE' },
      { label: 'AI / ML MODEL', sub: 'LLM · EMBEDDINGS' },
      { label: 'DATA / KNOWLEDGE', sub: 'VECTOR SEARCH · DOCUMENTS' },
      { label: 'OUTPUT', sub: 'CITED ANSWER' },
    ],
  },
  {
    id: 'agentic-ai-system',
    index: '04',
    title: 'AGENTIC AI SYSTEM',
    category: 'AGENTIC AI',
    tagline: 'An autonomous AI system that plans, calls tools and executes multi-step workflows.',
    tech: ['LLMs', 'AI Agents', 'Tool Calling', 'Automation', 'Reasoning Workflows'],
    problem: [
      'Real tasks span multiple tools, APIs and steps — a single prompt cannot execute them.',
      'This system explores agents that reason, plan, call tools and verify their own work. [PLACEHOLDER — describe the workflow domain you automated.]',
    ],
    approach: [
      'Decompose complex tasks into structured reasoning workflows.',
      'The agent orchestrates tool calls, checking results at each step.',
      'Design for reliability: retries, guardrails and visible reasoning.',
    ],
    architecture: [
      'Task intake → planner decomposes the goal into steps.',
      'The agent selects and calls tools for each step.',
      'Results feed back into the reasoning loop until the task completes.',
      'Automation layer connects to the external systems being operated.',
    ],
    technology: [
      'LLMs — the reasoning and planning core.',
      'AI Agents — autonomous task execution.',
      'Tool Calling — structured interaction with external capabilities.',
      'Automation — end-to-end workflow execution.',
    ],
    implementation: [
      'Implemented the agent loop: plan → act → observe → iterate.',
      'Defined tool schemas and a calling protocol for the agent.',
      'Added guardrails and failure handling for production reliability.',
      '[PLACEHOLDER — add frameworks and specifics.]',
    ],
    results: ['[PLACEHOLDER — add your outcomes: tasks automated, reliability, learnings.]'],
    demo: '[PLACEHOLDER — demo link]',
    source: '[PLACEHOLDER — source code link]',
    pipeline: [
      { label: 'USER', sub: 'TASK' },
      { label: 'APPLICATION', sub: 'AGENT ORCHESTRATOR' },
      { label: 'AI / ML MODEL', sub: 'LLM · REASONING' },
      { label: 'DATA / KNOWLEDGE', sub: 'TOOLS · AUTOMATION' },
      { label: 'OUTPUT', sub: 'TASK COMPLETED' },
    ],
  },
  {
    id: 'data-science-project',
    index: '05',
    title: 'DATA SCIENCE PROJECT',
    category: 'DATA SCIENCE + MACHINE LEARNING',
    tagline: 'From raw data to decisions — full-stack analytics with Python, Pandas, EDA and ML.',
    tech: ['Python', 'Pandas', 'EDA', 'Visualization', 'Machine Learning'],
    problem: [
      'Raw data hides the signal that drives good decisions.',
      'This project follows the complete analytics workflow — cleaning, exploration, visualisation and modelling — to turn a dataset into insight. [PLACEHOLDER — describe the dataset and question you explored.]',
    ],
    approach: [
      'Start with questions, then let EDA shape the modelling strategy.',
      'Clean and engineer features with Pandas.',
      'Communicate findings with clear visualisations, then validate with ML models.',
    ],
    architecture: [
      'Data ingestion and cleaning in Pandas.',
      'Exploratory analysis: distributions, correlations, missingness.',
      'Feature engineering and modelling.',
      'Visualisation layer turns results into readable insight.',
    ],
    technology: [
      'Python — the analytics language.',
      'Pandas — data manipulation and cleaning.',
      'EDA — structured exploration of the dataset.',
      'Visualization — charts that communicate findings.',
      'Machine Learning — models that confirm and predict.',
    ],
    implementation: [
      'Built a reproducible analysis pipeline from ingestion to report.',
      'Documented findings at every stage of the EDA.',
      '[PLACEHOLDER — add dataset, libraries, model results.]',
    ],
    results: ['[PLACEHOLDER — add your outcomes: key findings, model performance, learnings.]'],
    demo: '[PLACEHOLDER — demo link]',
    source: '[PLACEHOLDER — source code link]',
    pipeline: [
      { label: 'USER', sub: 'QUESTION' },
      { label: 'APPLICATION', sub: 'ANALYSIS PIPELINE' },
      { label: 'AI / ML MODEL', sub: 'ML · STATISTICS' },
      { label: 'DATA / KNOWLEDGE', sub: 'PANDAS · EDA' },
      { label: 'OUTPUT', sub: 'INSIGHT' },
    ],
  },
]

// ---------------------------------------------------------------------------
//  EXPERIMENTS (the WORLD 08 modules)
// ---------------------------------------------------------------------------

export interface Experiment {
  id: string
  code: string
  name: string
  desc: string
  status: 'PROTOTYPE' | 'EXPLORING' | 'ACTIVE'
  stack: string[]
}

export const experiments: Experiment[] = [
  { id: 'rag', code: 'EXP-01', name: 'RAG ASSISTANT', desc: 'Retrieval-augmented answering over private knowledge bases — chunking, embedding, retrieval, citation.', status: 'PROTOTYPE', stack: ['LLM', 'EMBEDDINGS', 'VECTOR SEARCH'] },
  { id: 'agents', code: 'EXP-02', name: 'TASK ORCHESTRATOR', desc: 'Agents that plan and execute multi-step workflows with tool calling and guardrails.', status: 'EXPLORING', stack: ['LLMS', 'TOOL CALLING', 'WORKFLOWS'] },
  { id: 'llm', code: 'EXP-03', name: 'PROMPT LAB', desc: 'Prompting, evaluation and structured-output experiments across model families.', status: 'EXPLORING', stack: ['LLMS', 'EVAL', 'PROMPTING'] },
  { id: 'cv', code: 'EXP-04', name: 'VISION PIPELINES', desc: 'Computer-vision experiments — image processing, detection and recognition flows.', status: 'PROTOTYPE', stack: ['CV', 'IMAGE PROCESSING', 'ML'] },
  { id: 'ml', code: 'EXP-05', name: 'MODEL BENCHMARKS', desc: 'Systematic model comparison and evaluation experiments on real datasets.', status: 'EXPLORING', stack: ['ML', 'EVALUATION', 'DATA'] },
  { id: 'data', code: 'EXP-06', name: 'DATA PIPELINES', desc: 'Clean, reusable pipelines for EDA and analytics — from ingestion to insight.', status: 'ACTIVE', stack: ['PANDAS', 'EDA', 'AUTOMATION'] },
  { id: 'automation', code: 'EXP-07', name: 'AI AUTOMATION', desc: 'Automating repetitive knowledge work with agents, APIs and generated code.', status: 'EXPLORING', stack: ['AGENTS', 'APIS', 'AUTOMATION'] },
]

// ---------------------------------------------------------------------------
//  EXPERIENCE — 3D timeline milestones (placeholders ready for your data)
// ---------------------------------------------------------------------------

export interface Milestone {
  id: string
  org: string
  role: string
  duration: string
  responsibilities: string[]
  technologies: string[]
  achievements: string[]
}

export const timeline: Milestone[] = [
  {
    id: 'ms-1',
    org: '[PLACEHOLDER — ORGANIZATION]',
    role: '[PLACEHOLDER — ROLE]',
    duration: '[PLACEHOLDER — DURATION]',
    responsibilities: ['[PLACEHOLDER — add a responsibility]'],
    technologies: ['[TECH]'],
    achievements: ['[PLACEHOLDER — add an achievement]'],
  },
  {
    id: 'ms-2',
    org: '[PLACEHOLDER — ORGANIZATION]',
    role: '[PLACEHOLDER — ROLE]',
    duration: '[PLACEHOLDER — DURATION]',
    responsibilities: ['[PLACEHOLDER — add a responsibility]'],
    technologies: ['[TECH]'],
    achievements: ['[PLACEHOLDER — add an achievement]'],
  },
  {
    id: 'ms-3',
    org: '[PLACEHOLDER — ORGANIZATION]',
    role: '[PLACEHOLDER — ROLE]',
    duration: '[PLACEHOLDER — DURATION]',
    responsibilities: ['[PLACEHOLDER — add a responsibility]'],
    technologies: ['[TECH]'],
    achievements: ['[PLACEHOLDER — add an achievement]'],
  },
]

// ---------------------------------------------------------------------------
//  EDUCATION
// ---------------------------------------------------------------------------

export const education = {
  degree: 'BACHELOR OF ENGINEERING',
  field: 'ARTIFICIAL INTELLIGENCE & MACHINE LEARNING',
  institution: '[PLACEHOLDER — INSTITUTION]',
  graduation: '[PLACEHOLDER — GRADUATION YEAR]',
  note: 'Focus areas: machine learning, deep learning, data science and AI systems. [PLACEHOLDER — add coursework, projects or honours.]',
}
