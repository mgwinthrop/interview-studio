import type { Metadata } from "next";
import localFont from "next/font/local";
import "./globals.css";

const manrope = localFont({
  src: "./fonts/GeistVF.woff",
  variable: "--font-manrope",
  display: "swap",
});

export const metadata: Metadata = {
  title: "MG Interview Studio | Michael Gray",
  description: "Conversational AI interviewer for software engineering delivery insights",
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
