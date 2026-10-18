import type { Metadata } from "next";
import localFont from "next/font/local";
import "./globals.css";

const manrope = localFont({
  src: "./fonts/GeistVF.woff",
  variable: "--font-manrope",
  display: "swap",
});

export const metadata: Metadata = {
  title: "MG Interview Studio",
  description: "Voice-first interview practice with an animated AI interviewer, transcripts and structured feedback",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={manrope.variable}>
      <body className="antialiased">
        {children}
      </body>
    </html>
  );
}
