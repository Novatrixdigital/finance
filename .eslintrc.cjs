module.exports = {
  root: true,
  env: { browser: true, es2022: true, node: true },
  extends: [
    'eslint:recommended',
    'plugin:react/recommended',
    'plugin:react/jsx-runtime',
    'plugin:react-hooks/recommended',
  ],
  ignorePatterns: ['dist', 'node_modules', 'public/_worker.js', '.eslintrc.cjs'],
  parserOptions: { ecmaVersion: 'latest', sourceType: 'module' },
  settings: { react: { version: '18.3' } },
  plugins: ['react-refresh'],
  rules: {
    'react/prop-types': 'off',
    'react/no-unescaped-entities': 'off',
    'react-refresh/only-export-components': 'off',
    // Unused variables fail the build rather than warn. `npm run lint` runs
    // with --max-warnings 0, so a "warning" here was only ever a slower error —
    // and five of them sat in the tree unnoticed because nothing in CI ran.
    'no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
    'no-empty': ['error', { allowEmptyCatch: true }],
    // A stray console.log reaches production and leaks whatever it prints.
    // Deliberate diagnostics (warn/error) stay allowed.
    'no-console': ['error', { allow: ['warn', 'error'] }],
  },
  overrides: [
    {
      // The Worker has no other way to report; `wrangler tail` reads stdout.
      files: ['worker/**/*.js', 'scripts/**/*.{js,mjs,cjs}'],
      rules: { 'no-console': 'off' },
    },
    {
      files: ['**/*.test.{js,jsx}'],
      env: { node: true },
    },
  ],
};
