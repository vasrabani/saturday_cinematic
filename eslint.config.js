// ESLint flat config. js/flat.js is a classic browser script (no modules,
// no bundler): production includes it with a plain <script> tag. It is
// generated from js/shared/ and js/src/ by tools/build.js, and it is the
// artefact that is linted — the fragments share one function scope, so
// linting them separately would report every cross-reference as undefined.
const js = require('@eslint/js');
const globals = require('globals');

module.exports = [
  js.configs.recommended,
  {
    files: ['js/flat.js'],
    languageOptions: {
      ecmaVersion: 2020,
      sourceType: 'script',
      globals: { ...globals.browser, gsap: 'readonly' },
    },
    rules: {
      'no-unused-vars': ['warn', { args: 'none', vars: 'all' }],
      'prefer-const': 'warn',
      'no-var': 'error',
      eqeqeq: ['warn', 'smart'],
    },
  },
  {
    // Browser-console tooling for the sandbox page.
    files: ['tools/**/*.js'],
    languageOptions: {
      ecmaVersion: 2020,
      sourceType: 'script',
      globals: { ...globals.browser, gsap: 'readonly' },
    },
  },
  {
    // Node scripts, unlike the rest of tools/ (which is browser-console
    // tooling pasted into the sandbox page).
    files: ['tools/build.js', 'tools/check-integration.js'],
    languageOptions: { ecmaVersion: 2022, sourceType: 'commonjs', globals: { ...globals.node } },
  },
  {
    files: ['tests/**/*.js', 'eslint.config.js'],
    languageOptions: { ecmaVersion: 2022, sourceType: 'commonjs', globals: { ...globals.node } },
  },
];
