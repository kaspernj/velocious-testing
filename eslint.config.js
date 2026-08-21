export default [
  {ignores: ["build/**", "node_modules/**", "coverage/**"]},
  {
    files: ["src/**/*.js", "scripts/**/*.js", "tests/**/*.mjs"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      globals: {
        console: "readonly",
        globalThis: "readonly",
        process: "readonly",
        setTimeout: "readonly",
        clearTimeout: "readonly",
        URL: "readonly"
      }
    },
    rules: {
      "no-constant-binary-expression": "error",
      "no-debugger": "error",
      "no-duplicate-imports": "error",
      "no-unreachable": "error",
      "no-unused-vars": ["error", {"argsIgnorePattern": "^_"}],
      "no-var": "error",
      "prefer-const": "error",
      "eqeqeq": "error"
    }
  }
]
