// ============================================================================
//  ASK MY PORTFOLIO — knowledge base for the in-world AI assistant.
//  Rule-based retrieval over VERIFIED content only. The assistant can never
//  answer outside this file — no invented experience, projects, metrics,
//  certifications or achievements.
// ============================================================================

import { profile, about, projects, experiments, timeline, education, worlds, intersection } from './portfolio'

export interface KBEntry {
  id: string
  source: string
  answer: string
  keywords: string[]
}

const projectList = projects
  .map((p) => `${p.index}. ${p.title} — ${p.category}. ${p.tagline}`)
  .join('\n')

const techList = [
  'Artificial Intelligence', 'Machine Learning', 'Deep Learning', 'Generative AI', 'RAG', 'AI Agents',
  'Computer Vision', 'NLP', 'Data Science', 'Data Engineering', 'Software Engineering', 'Backend Development',
  'APIs', 'Web Development', 'Android', 'Kotlin', 'React', 'Cloud', 'Automation', 'Developer Tools',
  'Emerging Technologies', 'Python',
].join(' · ')

const worldsList = worlds
  .map((w) => `WORLD ${w.index} · ${w.title} — ${w.tagline}. ${w.blurb}`)
  .join('\n')

const experimentList = experiments
  .map((e) => `${e.code} ${e.name} — STATUS: ${e.status} — STACK: ${e.stack.join(' · ')}`)
  .join('\n')

const timelineNote = timeline.some((m) => m.org.includes('PLACEHOLDER'))
  ? 'The experience timeline is currently in placeholder mode — Riyan is updating it with real milestones. Check the EXPERIENCE sector for the latest state.'
  : timeline.map((m) => `${m.role} @ ${m.org} — ${m.duration}`).join('\n')

const ragProject = projects.find((p) => p.id === 'rag-knowledge-assistant')!
const androidProject = projects.find((p) => p.id === 'akshara-deepa-tutor')!

export const KB: KBEntry[] = [
  {
    id: 'kb-identity',
    source: 'PROFILE.DB',
    answer: `Riyan Pasha is a technologist and builder — brand: ${profile.brand}. ${about.intro}\n\nCore message: "${profile.coreMessage}"\n\nAI Product Engineering is one of his specialties — the intersection of AI, data and software — not the boundary of who he is.`,
    keywords: ['who is', 'identity', 'tech king', 'king', 'brand', 'technologist', 'builder', 'about you', 'about riyan', 'tell me about riyan', 'yourself', 'specialty', 'product engineer'],
  },
  {
    id: 'kb-projects',
    source: 'PROJECTS.DB',
    answer: `Riyan has built ${projects.length} featured projects:\n${projectList}\n\nOpen the PROJECTS sector for full case studies, or ask me about a specific one.`,
    keywords: ['project', 'built', 'build', 'work', 'made', 'created', 'portfolio', 'product', 'what has', 'shipped'],
  },
  {
    id: 'kb-tech',
    source: 'SKILLS.DB',
    answer: `Riyan works across the whole technology stack: ${techList}.\n\nHe doesn't belong to one technology — he builds across technology.`,
    keywords: ['technology', 'technologies', 'tech', 'stack', 'skill', 'skills', 'tools', 'language', 'languages', 'framework', 'use', 'uses', 'know'],
  },
  {
    id: 'kb-worlds',
    source: 'UNIVERSE.DB',
    answer: `The Tech Universe has ${worlds.length} worlds:\n${worldsList}\n\nAI, data and software intersect at the core: ${intersection.formula.join(' + ')} = ${intersection.result}.`,
    keywords: ['world', 'universe', 'domain', 'areas', 'fields', 'ecosystem', 'specialties'],
  },
  {
    id: 'kb-android',
    source: 'PROJECTS.DB',
    answer: `Riyan builds native Android products (WORLD 04 · MOBILE). Featured: ${androidProject.title} — ${androidProject.category}. ${androidProject.tagline}\n\nStack: ${androidProject.tech.join(', ')}.`,
    keywords: ['android', 'kotlin', 'mobile', 'app', 'compose', 'device'],
  },
  {
    id: 'kb-rag',
    source: 'PROJECTS.DB',
    answer: `${ragProject.title} (${ragProject.index}) — ${ragProject.category}.\n\n${ragProject.tagline}\n\nPipeline: ${ragProject.pipeline.map((l) => l.label).join(' → ')}. Stack: ${ragProject.tech.join(', ')}.`,
    keywords: ['rag', 'retrieval', 'knowledge assistant', 'vector', 'embedding', 'grounded', 'hallucination'],
  },
  {
    id: 'kb-agents',
    source: 'PROJECTS.DB',
    answer: `The Agentic AI System (04) explores autonomous workflows: ${projects[3].tagline}\n\nStack: ${projects[3].tech.join(', ')}.`,
    keywords: ['agent', 'agentic', 'tool calling', 'automation', 'workflow', 'orchestrat'],
  },
  {
    id: 'kb-core',
    source: 'PROFILE.DB',
    answer: `Riyan's core message: "${profile.coreMessage}"\n\nTagline: ${profile.tagline}.`,
    keywords: ['core', 'message', 'philosophy', 'quote'],
  },
  {
    id: 'kb-about',
    source: 'ABOUT.DB',
    answer: `${about.intro}\n\nFocus areas: ${about.tags.join(' · ')}.`,
    keywords: ['about', 'background', 'profile', 'intro', 'summary'],
  },
  {
    id: 'kb-education',
    source: 'EDUCATION.DB',
    answer: `${education.degree} — ${education.field}.\nInstitution: ${education.institution}.\nGraduation: ${education.graduation}.`,
    keywords: ['education', 'degree', 'study', 'studied', 'bachelor', 'college', 'university', 'graduate', 'graduation'],
  },
  {
    id: 'kb-experience',
    source: 'EXPERIENCE.DB',
    answer: `Riyan's career path is rendered as a 3D timeline in the universe.\n\n${timelineNote}`,
    keywords: ['experience', 'career', 'job', 'jobs', 'role', 'work history', 'employed', 'worked at', 'company'],
  },
  {
    id: 'kb-experiments',
    source: 'EXPERIMENTS.DB',
    answer: `WORLD 08 · EXPERIMENTS holds ${experiments.length} modules:\n${experimentList}`,
    keywords: ['lab', 'experiment', 'prototype', 'exploring', 'research', 'idea'],
  },
  {
    id: 'kb-contact',
    source: 'CONTACT.DB',
    answer: `You can reach Riyan via email (${profile.contact.email}), LinkedIn (${profile.contact.linkedin}) or GitHub (${profile.contact.github}). There is also a message form in the CONTACT sector.`,
    keywords: ['contact', 'email', 'reach', 'hire', 'linkedin', 'github', 'connect', 'talk', 'message', 'chat', 'available'],
  },
  {
    id: 'kb-cv',
    source: 'VISION.DB',
    answer: `The best project to start with depends on what interests you:\n- Android + Generative AI → ${projects[0].title}\n- Computer Vision → ${projects[1].title}\n- RAG → ${projects[2].title}\n- Agentic AI → ${projects[3].title}\n- Data Science → ${projects[4].title}\n\nAsk me anything about a specific one.`,
    keywords: ['recommend', 'suggest', 'which project', 'best project', 'start with', 'interesting', 'impressive', 'favourite', 'favorite'],
  },
]

/** naive-but-honest intent matching: score = sum of keyword hit lengths */
export function retrieveAnswer(raw: string): { entry: KBEntry; score: number } | null {
  const q = raw.toLowerCase()
  let best: { entry: KBEntry; score: number } | null = null
  for (const entry of KB) {
    let score = 0
    for (const kw of entry.keywords) {
      const k = kw.toLowerCase()
      if (q.includes(k)) score += k.length
    }
    if (score > 0 && (!best || score > best.score)) best = { entry, score }
  }
  return best
}

export const SUGGESTED_QUESTIONS = [
  'What AI projects has Riyan built?',
  'What technologies does Riyan use?',
  'Who is Riyan?',
  'Which project demonstrates RAG?',
  'What is Riyan\'s core message?',
]
