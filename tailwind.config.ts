import type { Config } from "tailwindcss";

export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        sans: ["Inter", "Segoe UI", "system-ui", "sans-serif"],
      },
      boxShadow: {
        widget: "0 18px 60px rgba(15, 23, 42, 0.18)",
      },
    },
  },
  plugins: [],
} satisfies Config;
