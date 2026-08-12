import type { Metadata, Viewport } from "next";
import "./globals.css";
import { ReactQueryProvider } from "@/lib/react-query-provider";
import { ThemeProvider } from "@/components/theme-provider";
import { ViewportHeightFix } from "@/components/viewport-height-fix";
import { Inter } from "next/font/google";

const inter = Inter({ 
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});

export const metadata: Metadata = {
  title: "ThinkTable - AI Chat for Visual Mind Mapping",
  description: "Transform conversations into smart visual mind maps. Learn visually with AI-powered chat and interactive diagrams.",
  icons: {
    icon: "/thinktable-logo.svg",
  },
};

// Board has its own pinch-zoom — lock browser page zoom so iOS doesn’t auto-zoom on TipTap focus
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className={inter.variable} suppressHydrationWarning>
        <ViewportHeightFix />
        <ThemeProvider>
          <ReactQueryProvider>{children}</ReactQueryProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}

