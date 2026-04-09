/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./src/**/*.{js,ts,jsx,tsx,mdx}"],
  theme: {
    extend: {
      fontFamily: {
        gmarket: ["GmarketSans", "sans-serif"],
        pretendard: ["Pretendard Variable", "Pretendard", "sans-serif"],
      },
      colors: {
        primary: "#9B7DD4",
        secondary: "#8BACD8",
        accent: "#C084FC",
        dark: "#1A1A2E",
      },
      keyframes: {
        "confetti-burst": {
          "0%": {
            opacity: "1",
            transform: "translate(0, 0) rotate(0deg) scale(1)",
          },
          "70%": {
            opacity: "1",
          },
          "100%": {
            opacity: "0",
            transform:
              "translate(var(--tx), var(--ty)) rotate(var(--rot)) scale(0.4)",
          },
        },
      },
      animation: {
        "confetti-burst":
          "confetti-burst var(--dur) ease-out var(--delay) forwards",
      },
    },
  },
  plugins: [],
};
