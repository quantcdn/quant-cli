import globals from 'globals';

export default [
  {
    ignores: [
      'coverage/**',
      'node_modules/**',
      '.git/**',
      // Edge function bodies: the edge wraps them in a function, so they
      // can use a top-level return.
      'tests/fixtures/**/edge-functions/**',
      // A copy of the Orbit live checklist script, kept in its own style.
      'tests/fixtures/orbit-live-check.mjs'
    ]
  },
  {
    files: ['**/*.js', '**/*.mjs'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: {
        ...globals.node
      }
    },
    rules: {
      'no-unused-vars': ['error', {
        argsIgnorePattern: '^_',
        varsIgnorePattern: '^_',
        caughtErrorsIgnorePattern: '^_'
      }],
      'no-console': 'off',
      'semi': ['error', 'always'],
      'quotes': ['error', 'single', { avoidEscape: true }],
      'indent': ['error', 2, { SwitchCase: 1 }],
      'comma-dangle': ['error', 'never'],
      'no-trailing-spaces': 'error',
      'eol-last': ['error', 'always']
    }
  },
  {
    files: [
      'src/serve/**/*.js',
      'src/helper/quant-meta.js',
      'src/helper/edge-rules-manifest.js',
      'src/commands/serve.js',
      'src/commands/kv.js',
      'src/commands/kv-indexes.js'
    ],
    rules: {
      complexity: ['error', 10]
    }
  },
  {
    files: ['test/**/*.mjs'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: {
        ...globals.node,
        ...globals.mocha
      }
    }
  }
];
