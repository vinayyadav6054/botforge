import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "BotForge",
  description: "Build AI chatbots from your own documents",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
