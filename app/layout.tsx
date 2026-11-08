import type { Metadata } from "next";
import type { ReactNode } from "react";
import Header from "../components/Header";
import Footer from "../components/Footer";
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
          <Header />
          <main>{children}</main>
          <Footer />
        </CartProvider>
      </body>
    </html>
  );
}
