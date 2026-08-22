"use client"

import { useEffect, useRef, useState } from "react"
import type { ReactNode } from "react"

type Role = "user" | "assistant"

interface ChatMessage {
    id: string
    role: Role
    content: string
}

const SUGGESTED_PROMPTS = [
    "Explain DRS aerodynamics and its impact on dirty air",
    "Compare the 2026 power unit regulations with current specs",
    "How does a team execute a sub-2-second pit stop?",
    "Who holds the most Grand Slams in F1 history?",
]

const SCHEMES: Record<string, Record<string, string>> = {
    silver: {
        "--bg": "#f4f5f5", "--surface": "#ffffff", "--text-main": "#171b1c", "--text-muted": "#6b7474", "--border": "#e1e5e5", "--shadow": "rgba(20,25,26,0.08)"
    },
    milton: {
        "--bg": "#f2f5fa", "--surface": "#ffffff", "--text-main": "#101722", "--text-muted": "#5c6d84", "--border": "#dee6f0", "--shadow": "rgba(16,23,34,0.08)"
    },
    papaya: {
        "--bg": "#fdf6ef", "--surface": "#ffffff", "--text-main": "#241a10", "--text-muted": "#8a7563", "--border": "#efe0cf", "--shadow": "rgba(36,26,16,0.08)"
    },
    rosso: {
        "--bg": "#fdf3f2", "--surface": "#ffffff", "--text-main": "#241010", "--text-muted": "#8a6363", "--border": "#f2dcda", "--shadow": "rgba(36,16,16,0.08)"
    },
}

const MOODS = [
    { id: "silver", label: "SILVER ARROW", scheme: "silver", accent: "#00857f" },
    { id: "milton", label: "MILTON KEYNES", scheme: "milton", accent: "#c99e00" },
    { id: "papaya", label: "PAPAYA SPARK", scheme: "papaya", accent: "#ff8000" },
    { id: "rosso", label: "ROSSO CORSA", scheme: "rosso", accent: "#e10600" },
] as const

const uid = () => Math.random().toString(36).slice(2, 10)

/* ---------- Web Audio 赛车音效引擎 ---------- */
function playSound(type: "drs" | "start" | "go" | "send") {
    try {
        const Ctx = window.AudioContext || (window as any).webkitAudioContext
        const ctx = new Ctx()
        const t = ctx.currentTime

        if (type === "drs") {
            const osc = ctx.createOscillator()
            const gain = ctx.createGain()
            osc.type = "sawtooth"
            osc.frequency.setValueAtTime(300, t)
            osc.frequency.exponentialRampToValueAtTime(900, t + 0.16)
            osc.frequency.exponentialRampToValueAtTime(240, t + 0.36)
            gain.gain.setValueAtTime(0.0001, t)
            gain.gain.exponentialRampToValueAtTime(0.15, t + 0.04)
            gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.4)
            osc.connect(gain); gain.connect(ctx.destination)
            osc.start(t); osc.stop(t + 0.42)
            osc.onended = () => ctx.close()
        } else if (type === "start") {
            const osc = ctx.createOscillator()
            const gain = ctx.createGain()
            osc.type = "sine"
            osc.frequency.setValueAtTime(440, t)
            gain.gain.setValueAtTime(0.1, t)
            gain.gain.exponentialRampToValueAtTime(0.001, t + 0.15)
            osc.connect(gain); gain.connect(ctx.destination)
            osc.start(t); osc.stop(t + 0.16)
            osc.onended = () => ctx.close()
        } else if (type === "go") {
            const osc = ctx.createOscillator()
            const gain = ctx.createGain()
            osc.type = "triangle"
            osc.frequency.setValueAtTime(880, t)
            osc.frequency.exponentialRampToValueAtTime(1760, t + 0.3)
            gain.gain.setValueAtTime(0.15, t)
            gain.gain.exponentialRampToValueAtTime(0.001, t + 0.35)
            osc.connect(gain); gain.connect(ctx.destination)
            osc.start(t); osc.stop(t + 0.36)
            osc.onended = () => ctx.close()
        } else if (type === "send") {
            const osc = ctx.createOscillator()
            const gain = ctx.createGain()
            osc.type = "square"
            osc.frequency.setValueAtTime(600, t)
            osc.frequency.exponentialRampToValueAtTime(300, t + 0.1)
            gain.gain.setValueAtTime(0.08, t)
            gain.gain.exponentialRampToValueAtTime(0.001, t + 0.1)
            osc.connect(gain); gain.connect(ctx.destination)
            osc.start(t); osc.stop(t + 0.11)
            osc.onended = () => ctx.close()
        }
    } catch {
        // AudioContext unsupported, fail silently
    }
}

/* ---------- 拆分思考过程 / 正式答案 ---------- */
function splitThinking(raw: string): { thinking: string; answer: string } {
    const start = raw.indexOf("<<THINK>>")
    if (start === -1) return { thinking: "", answer: raw }
    const afterStart = start + "<<THINK>>".length
    const end = raw.indexOf("<<ENDTHINK>>", afterStart)
    if (end === -1) {
        return { thinking: raw.slice(afterStart), answer: raw.slice(0, start) }
    }
    const thinking = raw.slice(afterStart, end)
    const answer = raw.slice(0, start) + raw.slice(end + "<<ENDTHINK>>".length)
    return { thinking, answer }
}

/* ---------- Minimal Markdown Renderer ---------- */
function renderInline(text: string): ReactNode[] {
    const nodes: ReactNode[] = []
    const regex = /(\*\*([^*]+)\*\*|\*([^*]+)\*|`([^`]+)`|\[([^\]]+)\]\(([^)]+)\))/g
    let last = 0, key = 0, m: RegExpExecArray | null
    while ((m = regex.exec(text)) !== null) {
        if (m.index > last) nodes.push(text.slice(last, m.index))
        if (m[2] !== undefined) nodes.push(<strong key={key++}>{m[2]}</strong>)
        else if (m[3] !== undefined) nodes.push(<em key={key++}>{m[3]}</em>)
        else if (m[4] !== undefined) nodes.push(<code key={key++}>{m[4]}</code>)
        else if (m[5] !== undefined) nodes.push(<a key={key++} href={m[6]} target="_blank" rel="noreferrer">{m[5]}</a>)
        last = regex.lastIndex
    }
    if (last < text.length) nodes.push(text.slice(last))
    return nodes
}

function Markdown({ text }: { text: string }) {
    const lines = text.split("\n")
    const nodes: ReactNode[] = []
    let i = 0, key = 0
    while (i < lines.length) {
        const line = lines[i]
        if (line.trim().startsWith("```")) {
            const code: string[] = []
            i++
            while (i < lines.length && !lines[i].trim().startsWith("```")) {
                code.push(lines[i]); i++
            }
            i++
            nodes.push(<pre key={key++}><code>{code.join("\n")}</code></pre>)
            continue
        }
        if (/^\s*[-*]\s+/.test(line)) {
            const items: string[] = []
            while (i < lines.length && /^\s*[-*]\s+/.test(lines[i])) {
                items.push(lines[i].replace(/^\s*[-*]\s+/, "")); i++
            }
            nodes.push(<ul key={key++}>{items.map((it, idx) => <li key={idx}>{renderInline(it)}</li>)}</ul>)
            continue
        }
        if (line.trim() === "") { i++; continue }
        const para: string[] = []
        while (i < lines.length && lines[i].trim() !== "" && !/^\s*[-*]\s+/.test(lines[i]) && !lines[i].trim().startsWith("```")) {
            para.push(lines[i]); i++
        }
        nodes.push(<p key={key++}>{renderInline(para.join(" "))}</p>)
    }
    return <div className="md">{nodes}</div>
}

export default function Page() {
    const [messages, setMessages] = useState<ChatMessage[]>([])
    const [input, setInput] = useState("")
    const [isLoading, setIsLoading] = useState(false)
    const [isStreaming, setIsStreaming] = useState(false)

    const [litCount, setLitCount] = useState(0)
    const [greenFlash, setGreenFlash] = useState(false)
    const [expandedThinking, setExpandedThinking] = useState<Set<string>>(new Set())

    const [moodIndex, setMoodIndex] = useState(0)
    const feedRef = useRef<HTMLDivElement>(null)
    const abortRef = useRef<AbortController | null>(null)
    const mountedRef = useRef(false)
    const mood = MOODS[moodIndex]

    useEffect(() => {
        const root = document.documentElement
        const scheme = SCHEMES[mood.scheme]
        for (const [key, val] of Object.entries(scheme)) {
            root.style.setProperty(key, val)
        }
        root.style.setProperty("--accent", mood.accent)

        if (mountedRef.current) playSound("drs")
        else mountedRef.current = true
    }, [moodIndex])

    useEffect(() => {
        const el = feedRef.current
        if (el) el.scrollTop = el.scrollHeight
    }, [messages, isLoading])

    useEffect(() => {
        if (!isLoading || isStreaming) {
            setLitCount(0)
            return
        }
        const t = setInterval(() => {
            setLitCount((n) => {
                if (n >= 5) return 5
                playSound("start")
                return n + 1
            })
        }, 250)
        return () => clearInterval(t)
    }, [isLoading, isStreaming])

    useEffect(() => {
        if (isStreaming) {
            playSound("go")
            setGreenFlash(true)
            const timer = setTimeout(() => setGreenFlash(false), 600)
            return () => clearTimeout(timer)
        }
    }, [isStreaming])

    const toggleThinking = (id: string) => {
        setExpandedThinking((prev) => {
            const next = new Set(prev)
            if (next.has(id)) next.delete(id)
            else next.add(id)
            return next
        })
    }

    async function runCompletion(base: ChatMessage[]) {
        setIsLoading(true)
        setIsStreaming(false)
        const assistantId = uid()

        setMessages((prev) => [...prev, { id: assistantId, role: "assistant", content: "" }])

        const controller = new AbortController()
        abortRef.current = controller

        try {
            const res = await fetch("/api/chat", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ messages: base.map(m => ({ role: m.role, content: m.content })) }),
                signal: controller.signal,
            })
            if (!res.ok || !res.body) throw new Error("Network response was not ok")

            const reader = res.body.getReader()
            const decoder = new TextDecoder()
            let first = true

            while (true) {
                const { value, done } = await reader.read()
                if (done) break
                if (first) {
                    setIsStreaming(true)
                    first = false
                }
                const chunk = decoder.decode(value, { stream: true })
                setMessages((prev) => prev.map((m) => (m.id === assistantId ? { ...m, content: m.content + chunk } : m)))
            }
        } catch (err) {
            if ((err as Error)?.name !== "AbortError") {
                setMessages((prev) => prev.map((m) => (m.id === assistantId ? { ...m, content: "Telemetry lost. Please check connection." } : m)))
            }
        } finally {
            setIsLoading(false)
            setIsStreaming(false)
            abortRef.current = null
        }
    }

    function sendMessage(text: string) {
        const trimmed = text.trim()
        if (!trimmed || isLoading) return
        playSound("send")
        const next: ChatMessage[] = [...messages, { id: uid(), role: "user", content: trimmed }]
        setMessages(next)
        setInput("")
        runCompletion(next)
    }

    const showLights = (isLoading && !isStreaming) || greenFlash
    const noMessages = messages.length === 0

    return (
        <div className="app-shell">
            <header className="header">
                <div className="header-brand">
                    <div className="status-indicator">
                        <span className="live-dot" />
                        <span className="live-text">FIA TELEMETRY LIVE</span>
                    </div>
                    <h1 className="brand-title">F1 ChatBot <span className="rev-tag">V2026</span></h1>
                </div>
                <button className="mood-switch" onClick={() => setMoodIndex((i) => (i + 1) % MOODS.length)}>
                    <span className="mood-dot" />
                    {mood.label}
                </button>
            </header>

            <div className="feed" ref={feedRef}>
                {noMessages ? (
                    <div className="empty-state">
                        <div className="telemetry-badge">PITWALL AI // READY</div>
                        <h2 className="greeting">SYSTEMS NOMINAL.<br />CHOOSE A TELEMETRY QUERY:</h2>
                        <div className="prompt-grid">
                            {SUGGESTED_PROMPTS.map((p) => (
                                <button key={p} className="prompt-card" onClick={() => sendMessage(p)}>
                                    <span className="card-arrow">&gt;</span> {p}
                                </button>
                            ))}
                        </div>
                    </div>
                ) : (
                    <div className="chat-container">
                        {messages.map((m, index) => {
                            const isLastAI = index === messages.length - 1 && m.role === "assistant"
                            return (
                                <div key={m.id} className={`message ${m.role}`}>
                                    <div className="message-inner">
                                        <div className="avatar">{m.role === "user" ? "YOU" : "PIT"}</div>
                                        <div className="content">
                                            {m.role === "user" ? <div className="user-text">{m.content}</div> : null}

                                            {m.role === "assistant" && (() => {
                                                const { thinking, answer } = splitThinking(m.content)
                                                const isExpanded = expandedThinking.has(m.id)
                                                return (
                                                    <>
                                                        {isLastAI && showLights && (
                                                            <div className="start-lights-panel">
                                                                <span className="lights-title">START SEQUENCE</span>
                                                                <div className="micro-lights">
                                                                    {[0, 1, 2, 3, 4].map((i) => (
                                                                        <div key={i} className={`micro-light ${
                                                                            greenFlash ? "go" : (litCount > i ? (litCount === 5 ? "pulse" : "on") : "")
                                                                        }`} />
                                                                    ))}
                                                                </div>
                                                            </div>
                                                        )}

                                                        {thinking && (
                                                            <div className="thinking-block">
                                                                <button className="thinking-toggle" onClick={() => toggleThinking(m.id)}>
                                                                    {isExpanded ? "▾ Hide thinking" : "▸ Show thinking"}
                                                                </button>
                                                                {isExpanded && <div className="thinking-text">{thinking}</div>}
                                                            </div>
                                                        )}

                                                        {answer && (
                                                            <div className="assistant-bubble">
                                                                <Markdown text={answer} />
                                                            </div>
                                                        )}
                                                    </>
                                                )
                                            })()}
                                        </div>
                                    </div>
                                </div>
                            )
                        })}
                    </div>
                )}
            </div>

            <div className="console-wrapper">
                <div className="console">
                    <div className="console-prefix">TX&gt;</div>
                    <input
                        value={input}
                        onChange={(e) => setInput(e.target.value)}
                        onKeyDown={(e) => {
                            if (e.key === "Enter" && !e.nativeEvent.isComposing) {
                                e.preventDefault()
                                sendMessage(input)
                            }
                        }}
                        placeholder="Transmit command to pit wall..."
                    />
                    <button
                        className="send-btn"
                        onClick={() => sendMessage(input)}
                        disabled={!input.trim() || isLoading}
                    >
                        TRANSMIT
                    </button>
                </div>
            </div>

            <div className="chassis-plate">
                <span>F1GPT — Engineered by Isac</span>
            </div>
        </div>
    )
}