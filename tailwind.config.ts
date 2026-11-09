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
        inkLight: theme.colors.inkLight,
        surface: theme.colors.surface,
        panel: theme.colors.panel,
        card: theme.colors.card,
        border: theme.colors.border,
        brand: theme.colors.brand,
        brandDark: theme.colors.brandDark,
        brandDarker: theme.colors.brandDarker,
        brandLight: theme.colors.brandLight,
        accent: theme.colors.accent,
        accentDark: theme.colors.accentDark,
        accentDarker: theme.colors.accentDarker,
        logoGreen: theme.colors.logoGreen,
        logoNavy: theme.colors.logoNavy,
        logoWhite: theme.colors.logoWhite,
        success: theme.colors.success,
        muted: theme.colors.muted,
        mutedLight: theme.colors.mutedLight,
        mutedNavy: theme.colors.mutedNavy,
        text: theme.colors.text,
        textSoft: theme.colors.textSoft,
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
