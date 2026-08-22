import type { Metadata } from "next"
import { Teko } from "next/font/google"
import "./global.css"

const display = Teko({
    subsets: ["latin"],
    weight: ["500", "600", "700"],
    variable: "--font-display",
})

export const metadata: Metadata = {
    title: "F1 Chatbot",
    description: "Find out what you wannan know in F1 !!!",
    icons: "/icon.png",
}

const RootLayout = ({ children }: { children: React.ReactNode }) => {
    return (
        <html lang="en" className={display.variable}>
            <body>{children}</body>
        </html>
    )
}

export default RootLayout