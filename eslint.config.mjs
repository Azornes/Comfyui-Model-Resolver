import js from "@eslint/js";
import globals from "globals";

export default [
    js.configs.recommended,
    {
        files: ["web/**/*.js"],
        languageOptions: {
            ecmaVersion: 2022,
            sourceType: "module",
            globals: {
                ...globals.browser,
                // ComfyUI globals available at runtime
                app: "readonly",
                api: "readonly",
                LiteGraph: "readonly",
                LGraphCanvas: "readonly",
            },
        },
        rules: {
            // --- Errors (catch real bugs) ---
            "no-undef": "error",
            "no-unused-vars": ["warn", {
                argsIgnorePattern: "^_",
                varsIgnorePattern: "^_",
                caughtErrorsIgnorePattern: "^_",
            }],
            "no-redeclare": "error",
            "no-dupe-keys": "error",
            "no-duplicate-case": "error",
            "no-unreachable": "error",
            "no-constant-condition": ["error", { checkLoops: false }],
            "no-empty": ["error", { allowEmptyCatch: true }],
            "no-self-assign": "error",
            "no-self-compare": "error",

            // --- Warnings (code quality) ---
            "eqeqeq": ["warn", "smart"],
            "no-var": "warn",
            "prefer-const": ["warn", { destructuring: "all" }],
            "no-shadow": "off",                // too noisy with callback params
            "no-throw-literal": "warn",
            "no-useless-escape": "warn",
            "no-prototype-builtins": "off",     // project uses hasOwnProperty directly

            // --- Disabled (not applicable) ---
            "no-case-declarations": "off",      // project uses declarations in switch cases
        },
    },
    {
        // Test files can use Node.js globals
        files: ["tests/**/*.{js,mjs}"],
        languageOptions: {
            ecmaVersion: 2022,
            sourceType: "module",
            globals: {
                ...globals.node,
            },
        },
    },
    {
        // Ignore non-JS and generated files
        ignores: [
            "node_modules/",
            "__pycache__/",
            "*.py",
            ".git/",
        ],
    },
];
