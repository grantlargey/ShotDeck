import js from "@eslint/js";
import globals from "globals";
import { defineConfig } from "eslint/config";

export default defineConfig([
    {
        files: ["**/*.js"],
        extends: [js.configs.recommended],
        languageOptions: {
            ecmaVersion: "latest",
            sourceType: "module",
            globals: globals.node,
        },
        rules: {
            // `const { secret: _secret, ...rest } = row` is how a field is left out of a copy.
            "no-unused-vars": ["error", { ignoreRestSiblings: true }],
        },
    },
]);
