'use client'

import { useState, useEffect } from 'react'
import { Terminal, Cpu, Database, Shield, Zap, Layers, Activity, Server, Radio, CheckCircle } from 'lucide-react'

export default function AgentDashboard() {
  const [activeTab, setActiveTab] = useState<'CONSOLE' | 'TOOLS' | 'PIPELINE'>('CONSOLE')
  const [logs, setLogs] = useState<Array<{ id: number; time: string; type: string; msg: string }>>([
    { id: 1, time: '18:54:01', type: 'SYS', msg: 'RAVEN Core initialization sequence complete.' },
    { id: 2, time: '18:54:05', type: 'NET', msg: 'Neural embedding space synchronized.' },
    { id: 3, time: '18:54:12', type: 'RAV', msg: 'Context window allocated (128K tokens).' },
    { id: 4, time: '18:54:20', type: 'MEM', msg: 'Long-term vector store ready.' },
  ])

  useEffect(() => {
    const messages = [
      { type: 'RAV', msg: 'Evaluating prompt intent representation.' },
      { type: 'TOOLS', msg: 'Checking tool registry schema availability.' },
      { type: 'VERIFY', msg: 'Security boundaries enforced. Ready for query.' },
      { type: 'SYS', msg: 'Deterministic telemetry heart-beat OK.' },
    ]

    let logCounter = 5
    const interval = setInterval(() => {
      const sample = messages[Math.floor(Math.random() * messages.length)]
      const now = new Date().toTimeString().split(' ')[0]

      setLogs((prev) => [
        ...prev.slice(-6),
        { id: logCounter++, time: now, type: sample.type, msg: sample.msg },
      ])
    }, 4000)

    return () => clearInterval(interval)
  }, [])

  return (
    <div className="agent-dashboard-section">
      <div className="dash-header">
        <div className="dash-title-group">
          <span className="dash-tag mono">// CONTROL CENTER</span>
          <h2 className="dash-main-title">
            RAVEN <em className="text-lime">CONSOLE</em>
          </h2>
        </div>
        <div className="dash-controls">
          <button
            onClick={() => setActiveTab('CONSOLE')}
            className={`dash-tab ${activeTab === 'CONSOLE' ? 'active' : ''}`}
          >
            <Terminal size={14} />
            <span>CONSOLE LOGS</span>
          </button>
          <button
            onClick={() => setActiveTab('TOOLS')}
            className={`dash-tab ${activeTab === 'TOOLS' ? 'active' : ''}`}
          >
            <Cpu size={14} />
            <span>TOOL MATRIX</span>
          </button>
          <button
            onClick={() => setActiveTab('PIPELINE')}
            className={`dash-tab ${activeTab === 'PIPELINE' ? 'active' : ''}`}
          >
            <Layers size={14} />
            <span>EXECUTION PIPELINE</span>
          </button>
        </div>
      </div>

      <div className="dash-grid">
        {/* Panel 1: System Telemetry HUD */}
        <div className="dash-panel telemetry-panel">
          <div className="panel-header">
            <span className="panel-title mono">
              <Radio size={13} className="inline text-lime mr-2" />
              RAVEN CORE METRICS
            </span>
            <span className="panel-subtext mono">PROTOTYPE INTERFACE</span>
          </div>

          <div className="metrics-list">
            <div className="metric-row">
              <span className="metric-label">SYSTEM STATUS</span>
              <span className="metric-val text-lime">● ONLINE</span>
            </div>

            <div className="metric-row">
              <span className="metric-label">CONTEXT WINDOW</span>
              <div className="metric-bar-group">
                <div className="metric-bar">
                  <div className="metric-fill bg-cyan" style={{ width: '84%' }} />
                </div>
                <span className="metric-num font-mono">84%</span>
              </div>
            </div>

            <div className="metric-row">
              <span className="metric-label">REASONING MODE</span>
              <span className="metric-val text-cyan">ACTIVE</span>
            </div>

            <div className="metric-row">
              <span className="metric-label">VECTOR STORE</span>
              <span className="metric-val text-lime">SYNCHRONIZED</span>
            </div>

            <div className="metric-row">
              <span className="metric-label">SECURITY GAUNTLET</span>
              <span className="metric-val text-lime">ENFORCED</span>
            </div>
          </div>
        </div>

        {/* Panel 2: Interactive Terminal Log / Tool Matrix */}
        <div className="dash-panel main-console-panel">
          <div className="panel-header">
            <span className="panel-title mono">
              <Terminal size={13} className="inline text-cyan mr-2" />
              {activeTab === 'CONSOLE'
                ? 'REAL-TIME TELEMETRY STREAM'
                : activeTab === 'TOOLS'
                  ? 'REGISTERED TOOL SCHEMAS'
                  : 'VERIFICATION WORKFLOW'}
            </span>
            <span className="panel-subtext mono">LIVE TRACE</span>
          </div>

          <div className="panel-body">
            {activeTab === 'CONSOLE' && (
              <div className="console-stream">
                {logs.map((log) => (
                  <div key={log.id} className="console-line">
                    <span className="console-time mono">{log.time}</span>
                    <span className={`console-tag tag-${log.type.toLowerCase()} mono`}>[{log.type}]</span>
                    <span className="console-msg">{log.msg}</span>
                  </div>
                ))}
              </div>
            )}

            {activeTab === 'TOOLS' && (
              <div className="tools-matrix">
                {[
                  { name: 'Vision Landmarker', status: 'ACTIVE', desc: 'Real-time gesture & gaze detection' },
                  { name: 'Vector Retriever', status: 'READY', desc: 'Dense-sparse hybrid embedding search' },
                  { name: 'Tool Orchestrator', status: 'STANDBY', desc: 'Dynamic API & function execution' },
                  { name: 'Verification Gate', status: 'ACTIVE', desc: 'Constraint validation before output' },
                ].map((tool) => (
                  <div key={tool.name} className="tool-card">
                    <div className="tool-card-head">
                      <h4 className="tool-name">{tool.name}</h4>
                      <span className="tool-status text-lime mono">{tool.status}</span>
                    </div>
                    <p className="tool-desc">{tool.desc}</p>
                  </div>
                ))}
              </div>
            )}

            {activeTab === 'PIPELINE' && (
              <div className="pipeline-steps">
                {[
                  { step: '01', name: 'User Signal Ingestion', state: 'COMPLETE' },
                  { step: '02', name: 'Context Assembly & RAG', state: 'COMPLETE' },
                  { step: '03', name: 'Neural Model Reasoning', state: 'IN PROGRESS' },
                  { step: '04', name: 'Side-Effect Verification', state: 'PENDING' },
                ].map((p) => (
                  <div key={p.step} className="pipeline-step-row">
                    <span className="step-badge mono">{p.step}</span>
                    <span className="step-title">{p.name}</span>
                    <span className={`step-state mono ${p.state === 'COMPLETE' ? 'text-lime' : 'text-cyan'}`}>
                      {p.state}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
