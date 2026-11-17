import coreWebVitals from "eslint-config-next/core-web-vitals";
import typescript from "eslint-config-next/typescript";

const eslintConfig = [
  ...coreWebVitals,
  ...typescript,
  {
    // eslint-config-next 16 turned on React Compiler rules that flag long-standing effect
    // patterns. They are warnings until those effects are reworked and tested in the browser.
    rules: {
      "react-hooks/set-state-in-effect": "warn",
      "react-hooks/immutability": "warn",
      "react-hooks/preserve-manual-memoization": "warn",
    },
  },
  // .next-e2e is the Playwright build's output (FQ-108 S0), generated like .next.
  { ignores: [".next/**", ".next-e2e/**", "node_modules/**", "public/**", "next-env.d.ts"] },
];

export default eslintConfig;
