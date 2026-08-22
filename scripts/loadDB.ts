import { DataAPIClient } from "@datastax/astra-db-ts";
import { PuppeteerWebBaseLoader } from "@langchain/community/document_loaders/web/puppeteer";
import { RecursiveCharacterTextSplitter } from "@langchain/textsplitters";
import { pipeline } from "@xenova/transformers";
import "dotenv/config";

type SimilarityMetric = "dot_product" | "cosine" | "euclidean"

const { ASTRA_DB_NAMESPACE, ASTRA_DB_COLLECTION, ASTRA_DB_API_ENDPOINT, ASTRA_DB_APPLICATION_TOKEN } = process.env

let embedder: any = null
const getEmbedder = async () => {
    if (!embedder) {
        embedder = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2')
    }
    return embedder
}

const embedText = async (text: string): Promise<number[]> => {
    const model = await getEmbedder()
    const output = await model(text, { pooling: 'mean', normalize: true })
    return Array.from(output.data)
}

const f1Data = [
    // =========================
    // F1 General
    // =========================
    'https://en.wikipedia.org/wiki/Formula_One',
    'https://www.formula1.com/en',
    'https://www.formula1.com/en/latest',

    // =========================
    // 2026 Race & Championship Data
    // =========================
    'https://www.formula1.com/en/results/2026/races',
    'https://www.formula1.com/en/results/2026/drivers',
    'https://www.formula1.com/en/results/2026/team',
    'https://www.formula1.com/en/results.html',

    // =========================
    // Drivers & Teams
    // =========================
    'https://www.formula1.com/en/drivers',
    'https://www.formula1.com/en/teams',

    // =========================
    // 2026 F1 Grid & Teams
    // =========================
    'https://www.formula1.com/en/latest/article/2026-line-ups-confirmed-in-full-who-is-on-the-grid-for-next-season.3TyLfOUjOwpBKOp3KX1PiS',
    'https://www.formula1.com/en/latest/article/who-are-the-2026-formula-1-teams.1lkaenQFrnBNcRxQo28Ckv',
    'https://www.formula1.com/en/latest/article/drivers-teams-cars-circuits-and-more-everything-you-need-to-know-about.7iQfL3Rivf1comzdqV5jwc',

    // =========================
    // F1 Team History
    // =========================
    'https://www.formula1.com/en/latest/article/the-family-tree-f1-11-teams-and-how-they-came-to-be.2QBA1PPMf0bC8mp2xxqZeq',

    // =========================
    // F1 Technical Information
    // =========================
    'https://www.formula1.com/en/technical.html',

    // =========================
    // FIA Regulations
    // =========================
    'https://www.fia.com/regulations',
    'https://admin.fia.com/F126',
    'https://admin.fia.com/regulation/category/110',

    // =========================
    // 2026 F1 Regulation Updates
    // =========================
    'https://api.fia.com/news/fia-statement-amendments-2026-f1-regulations',
    'https://api.fia.com/news/refinements-2026-fia-formula-1-regulations-agreed-all-stakeholders',
    'https://api.fia.com/news/updated-fia-formula-one-world-championship-stewards-guidelines-driving-standards-penalties',

    // =========================
    // 2026 Season Analysis
    // =========================
    'https://www.formula1.com/en/latest/article/power-rankings-where-do-the-drivers-sit-at-the-halfway-stage-of-the-2026-season.2HCZA226oEu2MGEAwimWnG',
    'https://www.formula1.com/en/latest/article/5-things-to-look-forward-to-over-the-second-half-of-the-2026-f1-season.5TmWAKML3SuQdQisQkYQ02',

    // =========================
    // 2026 Current Driver / Team News
    // =========================
    'https://www.formula1.com/en/latest/article/verstappen-signs-contract-extension-with-red-bull-until-the-end-of-2030.4gUd8JEkYnKmD6bNMS5syw',
    'https://www.formula1.com/en/latest/article/i-dont-need-to-drive-in-another-colour-verstappen-explains-why-he-chose-to-stay-with-family-at-red-bull.4z0k66NtGxU2V8WlKEEg7N',
    'https://www.formula1.com/en/latest/article/exclusive-mekies-on-verstappens-new-deal-hadjars-injury-and-lawsons-red-bull-return.55ojbwIp1e0ULtEQtMjGg',
    'https://www.formula1.com/en/latest/article/its-going-to-be-challenging-lawson-shares-reaction-to-red-bull-opportunity-in-zandvoort.5UarWqWRSPC4CRaZcvDXMO',
    'https://www.formula1.com/en/latest/article/ive-been-dying-to-be-in-the-car-tsunoda-details-the-last-minute-call-that-sparked-his-f1-return.6VvvGN9Bno3ixUaRwpBanA',

    // =========================
    // 2026 Dutch Grand Prix
    // =========================
    'https://www.formula1.com/en/latest/article/need-to-know-the-most-important-facts-stats-and-trivia-ahead-of-the-2026-dutch-grand-prix.7rXg1scAXG5IMsHc9k74g4',

    // =========================
    // 2026 Season
    // =========================
    'https://www.formula1.com/en/racing/2026'
]

const client = new DataAPIClient(ASTRA_DB_APPLICATION_TOKEN)
const db = client.db(ASTRA_DB_API_ENDPOINT, { keyspace: ASTRA_DB_NAMESPACE })

const splitter = new RecursiveCharacterTextSplitter({
    chunkSize: 512,
    chunkOverlap: 100
})

const createCollection = async (similarityMetric: SimilarityMetric = 'dot_product') => {
    // 注意:维度改成了 384,对应本地模型的输出维度
    const res = await db.createCollection(ASTRA_DB_COLLECTION, { vector: { dimension: 384, metric: similarityMetric } })
    console.log(res)
}

const loadSampleData = async () => {
    const collection = await db.collection(ASTRA_DB_COLLECTION)
    for await (const url of f1Data) {
        const content = await scrapePage(url)
        const chunks = await splitter.splitText(content)
        for await (const chunk of chunks) {
            const vector = await embedText(chunk)

            const res = await collection.insertOne({
                $vector: vector,
                text: chunk
            })
            console.log(res)
        }
    }
}

const scrapePage = async (url: string) => {
    const loader = new PuppeteerWebBaseLoader(url, {
        launchOptions: { headless: true },
        gotoOptions: { waitUntil: "domcontentloaded" },
        evaluate: async (page, browser) => {
            const result = await page.evaluate(() => document.body.innerHTML)
            await browser.close()
            return result
        }
    })
    return (await loader.scrape())?.replace(/<[^>]*>?/gm, '')
}

createCollection().then(() => loadSampleData())