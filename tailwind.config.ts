import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        // Mimir palette: gunmetal workshop + forged bronze
        ink: {
          950: "#0d0f11", // app background
          900: "#121518", // panel background
          850: "#171b1f", // raised surface
          800: "#1e2328", // hover surface
          700: "#2a3037", // borders
        },
        bronze: {
          300: "#e8b878", // highlight
          400: "#d99f54", // primary accent
          500: "#c8853a", // accent strong
          600: "#a3672a", // pressed
        },
        parchment: {
          100: "#ece7dd", // primary text (warm off-white)
          400: "#a9aeb5", // secondary text
          600: "#6f757d", // muted text
        },
        signal: {
          ok: "#7fb069",
          err: "#d06c5b",
        },
      },
      fontFamily: {
        sans: ["IBM Plex Sans", "ui-sans-serif", "system-ui", "sans-serif"],
        mono: ["IBM Plex Mono", "ui-monospace", "SFMono-Regular", "monospace"],
      },
    },
  },
  plugins: [],
};
export default config;
