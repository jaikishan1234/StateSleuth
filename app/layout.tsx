import type { Metadata } from "next";
import "./globals.css";

const title = "StateSleuth — verification-first coding agent";
const description =
  "StateSleuth is a coding agent that independently verifies application behaviour. It drives the app like a real user, inspects the state left behind, and only calls a task done when the evidence matches the intent.";

export const metadata: Metadata = {
  title,
  description,
  applicationName: "StateSleuth",
  keywords: [
    "coding agent",
    "autonomous verification",
    "behavioural testing",
    "developer tools",
    "Openfire hackathon",
  ],
  openGraph: {
    title,
    description,
    siteName: "StateSleuth",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title,
    description,
  },
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className="min-h-screen antialiased">{children}</body>
    </html>
  );
}