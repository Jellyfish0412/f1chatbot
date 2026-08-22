import { DataAPIClient } from "@datastax/astra-db-ts"
import { pipeline } from "@xenova/transformers"

const { ASTRA_DB_NAMESPACE, ASTRA_DB_COLLECTION, ASTRA_DB_API_ENDPOINT, ASTRA_DB_APPLICATION_TOKEN, GROQ_API_KEY } = process.env

const client = new DataAPIClient(ASTRA_DB_APPLICATION_TOKEN)
const db = client.db(ASTRA_DB_API_ENDPOINT, { keyspace: ASTRA_DB_NAMESPACE })

let embedder: any = null
const getEmbedder = async () => {
    if (!embedder) {
        embedder = await pipeline("feature-extraction", "Xenova/all-MiniLM-L6-v2")
    }
    return embedder
}

const embedText = async (text: string): Promise<number[]> => {
    const model = await getEmbedder()
    const output = await model(text, { pooling: "mean", normalize: true })
    return Array.from(output.data)
}

export async function POST(req: Request) {
    try {
        const { messages }: { messages: { role: "user" | "assistant"; content: string }[] } = await req.json()
        const latestMessage = messages[messages.length - 1]
        const latestText = latestMessage.content

        let docContext = ""
        try {
            const vector = await embedText(latestText)
            const collection = await db.collection(ASTRA_DB_COLLECTION)
            const cursor = collection.find({}, { sort: { $vector: vector }, limit: 10 })
            const documents = await cursor.toArray()
            docContext = documents.map((doc) => doc.text).join("\n\n")
        } catch (err) {
            console.error("Error querying Astra DB:", err)
            docContext = ""
        }

        const systemPrompt = `You are an AI assistant who knows everything about Formula One.
Use the below context to augment what you know about Formula One racing.
The context will provide you with the most recent page data from wikipedia,
the official F1 website and others.
If the context doesn't include the information you need, answer based on
your existing knowledge and don't mention the source of your information or
what the context does or doesn't include.
Format responses using markdown where applicable and don't return images.

IMPORTANT: You only answer questions about Formula One (drivers, teams, races,
regulations, history, technology, etc). If the user asks about anything unrelated
to F1, politely decline and remind them this is an F1-only assistant. Do not
answer questions outside this scope, even if you know the answer.

----------------
START CONTEXT
${docContext}
END CONTEXT
----------------`

        const groqRes = await fetch("https://api.groq.com/openai/v1/chat/completions", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${GROQ_API_KEY}`,
            },
            body: JSON.stringify({
                model: "openai/gpt-oss-120b",
                messages: [{ role: "system", content: systemPrompt }, ...messages],
                stream: true,
                reasoning_effort: "low",
            }),
        })

        if (!groqRes.ok || !groqRes.body) {
            const errText = await groqRes.text()
            console.error("Groq API error:", errText)
            return new Response("Error processing chat request", { status: 500 })
        }

        // 把 Groq 的原始 SSE 流转成纯文字流,但用 <<THINK>>...<<ENDTHINK>> 标记包住思考过程
        const encoder = new TextEncoder()
        const decoder = new TextDecoder()
        let thinkOpened = false
        let thinkClosed = false

        const stream = new ReadableStream({
            async start(controller) {
                const reader = groqRes.body!.getReader()
                let buffer = ""

                while (true) {
                    const { value, done } = await reader.read()
                    if (done) break
                    buffer += decoder.decode(value, { stream: true })

                    const lines = buffer.split("\n")
                    buffer = lines.pop() ?? ""

                    for (const line of lines) {
                        const trimmed = line.trim()
                        if (!trimmed.startsWith("data:")) continue
                        const payload = trimmed.slice(5).trim()
                        if (payload === "[DONE]") continue

                        try {
                            const json = JSON.parse(payload)
                            const delta = json.choices?.[0]?.delta ?? {}
                            const reasoning = delta.reasoning ?? delta.reasoning_content ?? ""
                            const content = delta.content ?? ""

                            if (reasoning) {
                                if (!thinkOpened) {
                                    controller.enqueue(encoder.encode("<<THINK>>"))
                                    thinkOpened = true
                                }
                                controller.enqueue(encoder.encode(reasoning))
                            }

                            if (content) {
                                if (thinkOpened && !thinkClosed) {
                                    controller.enqueue(encoder.encode("<<ENDTHINK>>"))
                                    thinkClosed = true
                                }
                                controller.enqueue(encoder.encode(content))
                            }
                        } catch {
                            // 忽略解析失败的行
                        }
                    }
                }

                if (thinkOpened && !thinkClosed) {
                    controller.enqueue(encoder.encode("<<ENDTHINK>>"))
                }
                controller.close()
            },
        })

        return new Response(stream, {
            headers: { "Content-Type": "text/plain; charset=utf-8" },
        })
    } catch (err) {
        console.error(err)
        return new Response("Error processing chat request", { status: 500 })
    }
}