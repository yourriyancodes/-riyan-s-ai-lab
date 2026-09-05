import { siteConfig } from '@/data/siteConfig'

export interface AgentQueryResult {
  reply: string
  toolUsed: string
}

export async function processLocalQuery(query: string): Promise<AgentQueryResult> {
  const q = query.toLowerCase().trim()

  // Delay slightly to simulate processing
  await new Promise((r) => setTimeout(r, 400))

  // 1. Projects Query
  if (
    q.includes('project') ||
    q.includes('work') ||
    q.includes('built') ||
    q.includes('portfolio') ||
    q.includes('app') ||
    q.includes('system')
  ) {
    const projList = siteConfig.projects.map((p) => `• **${p.name}** (${p.technology}): ${p.description}`).join('\n')
    return {
      reply: `Here are Riyan's primary engineering systems and projects:\n\n${projList}\n\nYou can click on any project card below to inspect technical details!`,
      toolUsed: 'QueryTool: siteConfig.projects',
    }
  }

  // 2. Who is Riyan / Identity / Role
  if (
    q.includes('who') ||
    q.includes('riyan') ||
    q.includes('about') ||
    q.includes('background') ||
    q.includes('developer') ||
    q.includes('technologist')
  ) {
    return {
      reply: `Riyan Pasha is a **${siteConfig.roles.join(' · ')}**.\n\n"${siteConfig.about}"\n\nHis primary focus areas include AI, Agentic AI, Machine Learning, Deep Learning, Data Science, RAG, LLMs, Android, Software Engineering, Data, and Intelligent Systems.`,
      toolUsed: 'QueryTool: siteConfig.identity',
    }
  }

  // 3. Skills / Technologies
  if (
    q.includes('skill') ||
    q.includes('tech') ||
    q.includes('stack') ||
    q.includes('language') ||
    q.includes('ai') ||
    q.includes('ml') ||
    q.includes('rag') ||
    q.includes('llm')
  ) {
    return {
      reply: `Riyan specializes in:\n• **AI & Machine Learning**: Agentic Systems, RAG, LLMs, Deep Learning, Data Science\n• **Engineering**: Android Development, Software Architecture, System Automation\n• **Current Experiments**: Context Windows, Voice Interfaces, Small Models, Human Feedback Loops`,
      toolUsed: 'QueryTool: siteConfig.skills',
    }
  }

  // 4. Contact / Socials
  if (
    q.includes('contact') ||
    q.includes('email') ||
    q.includes('reach') ||
    q.includes('hire') ||
    q.includes('github') ||
    q.includes('social')
  ) {
    return {
      reply: `You can initiate a direct connection with Riyan using the contact links at the bottom of the page or reach out via Email/WhatsApp/LinkedIn.`,
      toolUsed: 'QueryTool: siteConfig.socialLinks',
    }
  }

  // 5. RAVEN Identity / Architecture
  if (
    q.includes('raven') ||
    q.includes('what are you') ||
    q.includes('who are you') ||
    q.includes('assistant') ||
    q.includes('architecture')
  ) {
    return {
      reply: `I am RAVEN — Riyan's Autonomous Virtual Engineering Nexus. I function as a human-like digital AI companion embedded directly inside his portfolio to represent his technological vision, architectural thinking, and systems engineering expertise.`,
      toolUsed: 'QueryTool: raven.sysInfo',
    }
  }

  // Default response
  return {
    reply: `I have analyzed your query ("${query}"). As Riyan's AI companion, I can guide you through his engineering projects, technological capabilities, and identity. Try asking: "What projects has Riyan built?" or "What technologies does Riyan work with?"`,
    toolUsed: 'QueryTool: fallbackIntent',
  }
}
