import globals from 'globals';

export default [
    { ignores: ['vendor/**', 'node_modules/**', 'test-results/**'] },
    {
        files: ['js/**/*.js'],
        languageOptions: {
            ecmaVersion: 2022,
            sourceType: 'module',
            globals: { ...globals.browser, PDFLib: 'readonly', JSZip: 'readonly', Sortable: 'readonly' },
        },
        rules: {
            'no-unused-vars': ['error', { args: 'none', caughtErrors: 'none' }],
            'no-undef': 'error',
            eqeqeq: ['error', 'smart'],
            'prefer-const': 'error',
            'no-var': 'error',
        },
    },
    {
        files: ['tests/**/*.js', 'tests/**/*.mjs', 'tools/**/*.mjs', '*.config.js'],
        languageOptions: { ecmaVersion: 2022, sourceType: 'module', globals: { ...globals.node, ...globals.browser } },
        rules: { 'no-unused-vars': ['error', { args: 'none' }] },
    },
];
