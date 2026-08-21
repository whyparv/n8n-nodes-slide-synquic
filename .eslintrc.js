/**
 * n8n's own node linter.
 *
 * These are the rules n8n reviewers apply when verifying a community node —
 * naming, casing, option ordering, description wording. Running them here means
 * we find issues before submission rather than in review feedback.
 */
module.exports = {
  root: true,
  env: { browser: true, es6: true, node: true },
  parser: '@typescript-eslint/parser',
  parserOptions: { project: ['./tsconfig.json'], sourceType: 'module', extraFileExtensions: ['.json'] },
  ignorePatterns: ['.eslintrc.js', '**/*.js', 'node_modules/**', 'dist/**'],
  overrides: [
    {
      files: ['package.json'],
      // package.json is JSON, not TypeScript — the TS parser cannot read it and
      // errors out unless it gets its own parser here.
      parser: 'jsonc-eslint-parser',
      plugins: ['eslint-plugin-n8n-nodes-base'],
      extends: ['plugin:n8n-nodes-base/community'],
      rules: { 'n8n-nodes-base/community-package-json-name-still-default': 'off' },
    },
    {
      files: ['./credentials/**/*.ts'],
      plugins: ['eslint-plugin-n8n-nodes-base'],
      extends: ['plugin:n8n-nodes-base/credentials'],
      rules: {
        // Contradicts cred-class-field-documentation-url-not-http-url, which
        // requires a full URL. The miscased rule expects a documentation SLUG,
        // which is how n8n's own built-in credentials work but is wrong for a
        // community node pointing at external docs. Autofixing it mangles the
        // URL into camelCase ('httpsSlideSynquicComDevelopers'), so it is off.
        'n8n-nodes-base/cred-class-field-documentation-url-miscased': 'off',
      },
    },
    {
      files: ['./nodes/**/*.ts'],
      plugins: ['eslint-plugin-n8n-nodes-base'],
      extends: ['plugin:n8n-nodes-base/nodes'],
      rules: {
        // These three contradict @n8n/community-nodes, the ruleset the OFFICIAL
        // verification scanner runs. This older plugin wants the string literal
        // ['main']; the scanner requires NodeConnectionTypes.Main and errors on
        // the literal. The scanner is the authority for verification, so the
        // typed constant wins and these are off.
        'n8n-nodes-base/node-class-description-inputs-wrong-regular-node': 'off',
        'n8n-nodes-base/node-class-description-outputs-wrong': 'off',
      },
    },
  ],
};
