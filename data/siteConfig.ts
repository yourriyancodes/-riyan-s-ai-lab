export const siteConfig = {
  name: 'Riyan Pasha',
  roles: ['Technologist', 'Developer', 'Problem Solver', 'Builder'],
  intro: 'I play with data, build systems, explore technology, and turn problems into things that work.',
  about: 'I build software, work with data, explore AI, and experiment with technology. The through-line is simple: turn difficult problems into functioning systems.',
  projects: [
    { number: '01', name: 'Akshara Deepa Tutor', description: 'A learning system exploring how language, structure, and feedback can make education more accessible.', technology: 'PRODUCT / LANGUAGE', status: 'EXPLORING', tone: 'ochre' },
    { number: '02', name: 'Sign Language Detector', description: 'A computer vision experiment translating gesture into a more immediate digital conversation.', technology: 'VISION / ML', status: 'PROTOTYPE', tone: 'blue' },
    { number: '03', name: 'RAG Knowledge Assistant', description: 'A retrieval interface for turning scattered context into useful, grounded answers.', technology: 'RETRIEVAL / AI', status: 'TESTING', tone: 'rose' },
    { number: '04', name: 'Agentic AI Project', description: 'An ongoing investigation into systems that can observe, reason, act, and verify.', technology: 'AGENTS / SYSTEMS', status: 'EXPLORING', tone: 'violet' },
    { number: '05', name: 'Data Science Project', description: 'Working with data to find signal, ask sharper questions, and support better decisions.', technology: 'DATA / RESEARCH', status: 'PAUSED', tone: 'green' },
  ],
  experiments: [
    ['Context windows', 'EXPLORING'], ['Voice interfaces', 'PROTOTYPE'], ['Small models', 'TESTING'], ['Human feedback loops', 'PAUSED']
  ],
  journey: ['Discover', 'Build', 'Experiment', 'Learn', 'Ship'],
  layers: [
    ['USER', 'The question, need, or signal that starts the loop.'], ['INTERFACE', 'A calm surface for making intent legible.'], ['RAVEN RUNTIME', 'The orchestration layer for future intelligence.'], ['AUTHORIZATION', 'Boundaries that keep action deliberate.'], ['CONTEXT', 'Relevant information, assembled with care.'], ['MODEL', 'A reasoning engine, selected for the task.'], ['TOOLS', 'Capabilities that let ideas touch reality.'], ['VERIFICATION', 'Checks before anything is considered done.'], ['MEMORY', 'The trace that helps a system learn.'],
  ],
  socialLinks: {
    WhatsApp: '',   // https://wa.me/<number>
    Email: '',      // mailto:you@example.com
    Instagram: '',
    GitHub: '',
    LinkedIn: '',
  },
  systemStatus: [['RAVEN CORE', 'READY'], ['INTERFACE', 'READY'], ['VOICE', 'OFFLINE'], ['DATABASE', 'OFFLINE'], ['MODEL', 'OFFLINE'], ['MEMORY', 'LIMITED']],
  ravenStates: ['IDLE', 'LISTENING', 'UNDERSTANDING', 'RESEARCHING', 'REASONING', 'PLANNING', 'WAITING', 'EXECUTING', 'VERIFYING', 'SPEAKING', 'SUCCESS', 'WARNING', 'ERROR', 'OFFLINE'],
} as const
