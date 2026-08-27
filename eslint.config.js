import js from "@eslint/js";

// Backend + tests only for now — the public/ frontend is plain browser JS
// with a different global set (window, document, crypto.subtle, fetch, ...)
// and linting it properly deserves its own pass rather than being bolted on
// here just to tick a box. Scoping down to code this actually checks
// correctly beats a config that "covers everything" but is wrong for half
// of it.
export default [
  js.configs.recommended,
  {
    files: ["controllers/**/*.js", "models/**/*.js", "routes/**/*.js", "config/**/*.js", "utils/**/*.js", "index.js", "tests/**/*.js"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      globals: { process: "readonly", console: "readonly", Buffer: "readonly", __dirname: "readonly", fetch: "readonly", AbortController: "readonly", global: "readonly", URL: "readonly", setTimeout: "readonly", clearTimeout: "readonly" },
    },
    rules: {
      "no-unused-vars": ["warn", { args: "none", varsIgnorePattern: "^_" }],
    },
  },
  {
    ignores: ["node_modules/**", "public/**"],
  },
];
