import js from "@eslint/js";
import { defineConfig } from "eslint/config";
import simpleImportSort from "eslint-plugin-simple-import-sort";
import solid from "eslint-plugin-solid/configs/typescript";
import globals from "globals";
import tseslint from "typescript-eslint";

export default defineConfig(
  {
    // config with just ignores is the replacement for `.eslintignore`
    ignores: [
      "**/dist/**",
      "**/coverage/**",
      "**/node_modules/**",
      "reference/**",
      "tmp/**",
      // standalone consumer app dogfooding the published package — has its own toolchain
      "playground/**",
      // CJS pnpm hook (tooling config, not project code)
      ".pnpmfile.cjs",
    ],
  },
  js.configs.recommended,
  tseslint.configs.strict,
  {
    plugins: {
      "simple-import-sort": simpleImportSort,
    },
    rules: {
      "simple-import-sort/imports": "error",
      "simple-import-sort/exports": "error",
    },
  },
  {
    files: ["**/*.ts", "**/*.tsx"],
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: {
        sourceType: "module",
        ecmaFeatures: {
          jsx: true,
        },
      },
      globals: {
        ...globals.browser,
        ...globals.es2022,
      },
    },
    // eslint-plugin-solid 0.14.x rule types predate ESLint 9's stricter Plugin typing
    plugins: solid.plugins as unknown as Record<string, import("eslint").ESLint.Plugin>,
    rules: {
      ...solid.rules,
      // eslint-plugin-solid 0.14.x predates Solid 2.0 — disable rules here
      // (with a comment citing the 2.0 idiom) as they false-positive.
      "@typescript-eslint/no-non-null-assertion": "off",
      // Solid's `let el!: HTMLDivElement` + ref attribute assigns outside ESLint's view
      "no-unassigned-vars": "off",
      "no-unused-vars": "off",
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          varsIgnorePattern: "^_",
          argsIgnorePattern: "^_",
          destructuredArrayIgnorePattern: "^_",
        },
      ],
    },
  },
  {
    files: ["src/**/*.ts", "src/**/*.tsx"],
    rules: {
      // The port mirrors AG Grid's interfaces, which use `any` pervasively
      // (TData = any etc.). Revisit after the v36 port reaches parity.
      "@typescript-eslint/no-explicit-any": "off",
    },
  },
  {
    files: ["test/**/*.ts", "test/**/*.tsx"],
    languageOptions: {
      globals: {
        ...globals.node,
      },
    },
  },
);
