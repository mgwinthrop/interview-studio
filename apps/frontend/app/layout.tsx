import type { Metadata } from "next";
import localFont from "next/font/local";
import "./globals.css";
import { SkipLink } from "./components/SkipLink";

const manrope = localFont({
  src: "./fonts/GeistVF.woff",
  variable: "--font-manrope",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Interview Studio",
  description: "Find your voice through guided conversations with AI interviewers and helpful feedback.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={manrope.variable}>
      <body className="antialiased">
        <SkipLink />
        {children}
      </body>
    </html>
  );
}
