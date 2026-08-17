import js from '@eslint/js';
import globals from 'globals';
import react from 'eslint-plugin-react';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';

export default [
  { ignores: ['dist', 'node_modules', 'supabase/functions/**'] },
  {
    files: ['**/*.{js,jsx}'],
    languageOptions: {
      ecmaVersion: 2022,
      globals: { ...globals.browser, ...globals.es2021 },
      parserOptions: {
        ecmaFeatures: { jsx: true },
        sourceType: 'module',
      },
    },
    settings: { react: { version: '18.3' } },
    plugins: {
      react,
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      ...js.configs.recommended.rules,
      ...react.configs.recommended.rules,
      ...react.configs['jsx-runtime'].rules,
      ...reactHooks.configs.recommended.rules,
      'react/prop-types': 'off',
      // Неразрывные пробелы допустимы в русских текстах и комментариях.
      'no-irregular-whitespace': ['error', { skipComments: true, skipStrings: true, skipTemplates: true, skipJSXText: true }],
      'react/no-unescaped-entities': 'off',
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
      'no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^[A-Z_]' }],
      // Запрет на возврат Base44 в кодовую базу.
      'no-restricted-imports': ['error', {
        patterns: [
          { group: ['@base44/*', '**/base44Client'], message: 'Base44 удалён из проекта — используйте @/api/client.' },
        ],
      }],
    },
  },
  {
    files: ['**/*.test.{js,jsx}'],
    languageOptions: { globals: { ...globals.node } },
  },
];
