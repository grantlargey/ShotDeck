import js from '@eslint/js'
import globals from 'globals'
import react from 'eslint-plugin-react'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{js,jsx}'],
    extends: [
      js.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
      parserOptions: {
        ecmaVersion: 'latest',
        ecmaFeatures: { jsx: true },
        sourceType: 'module',
      },
    },
    plugins: {
      react,
    },
    rules: {
      'no-unused-vars': 'error',
      'react/jsx-uses-vars': 'error',
    },
  },
])

// eslint-plugin-react-hooks v7's compiler-backed rules stop analyzing a
// component when its AST contains a try/finally statement. We intentionally do
// not ban try/finally here: several request handlers rely on its cleanup
// semantics, and rewriting those handlers is a behavior change outside this
// lint issue. The deep-link effect's narrow set-state-in-effect disable remains
// documented at its call site for the same reason.
