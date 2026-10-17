"use client";

import { SessionProvider } from "next-auth/react";
import { ThemeProvider } from "next-themes";
import { GoogleAnalytics } from "@next/third-parties/google";

import Footer from "../components/Footer";
import { AuthModalProvider } from "../components/AuthModalProvider";

export default function Providers({ children }) {
  return (
    <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
      <SessionProvider>
        <AuthModalProvider>
          {children}
          {/* Inside SessionProvider: the footer sat outside it, so the moment it
              needed useSession it would have thrown. */}
          <Footer />
        </AuthModalProvider>
      </SessionProvider>
      <GoogleAnalytics gaId="G-EBQQJCL50P" />
    </ThemeProvider>
  );
}
