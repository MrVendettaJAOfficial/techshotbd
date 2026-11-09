// Root layout — site header, footer and cart provider around
// every page, plus the site title and description metadata.

import type { Metadata } from "next";
import type { ReactNode } from "react";
import Header from "../components/Header";
import Footer from "../components/Footer";
import { AuthProvider } from "../lib/auth";
import { CartProvider } from "../lib/cart-store";
import "./globals.css";

export const metadata: Metadata = {
  title: "TechShot — Your next upgrade, delivered",
  description:
    "Great tech. Zero second guesses. Genuine phones, laptops, audio, gaming and subscriptions delivered across Bangladesh with official warranty.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-surface text-text antialiased">
        <CartProvider>
          {/* AuthProvider sits inside CartProvider (cart-store reads
              the session independently, see lib/cart-store.ts) and
              above the header, so the profile menu in the header
              gets auth state from useAuth. Pages that already wrap
              themselves in AuthProvider (/account, /admin, auth
              pages) keep working: the inner provider shadows this
              one with the same session. */}
          <AuthProvider>
            <Header />
            <main>{children}</main>
            <Footer />
          </AuthProvider>
        </CartProvider>
      </body>
    </html>
  );
}
