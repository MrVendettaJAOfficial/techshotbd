import type { Config } from "tailwindcss";
import { theme } from "./lib/theme";

const config: Config = {
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./lib/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        ink: theme.colors.ink,
        surface: theme.colors.surface,
        panel: theme.colors.panel,
        border: theme.colors.border,
        brand: theme.colors.brand,
        accent: theme.colors.accent,
        success: theme.colors.success,
        muted: theme.colors.muted,
        text: theme.colors.text,
      },
      fontFamily: {
        sans: ["Inter", "system-ui", "-apple-system", "Segoe UI", "sans-serif"],
      },
      maxWidth: { shell: "1312px" },
    },
  },
  plugins: [],
};
export default config;
