import { FlatCompat } from "@eslint/eslintrc";
const compat = new FlatCompat({ baseDirectory: import.meta.dirname });
export default [
  { ignores: [".next/**", "node_modules/**", "scripts/**", "next-env.d.ts"] },
  ...compat.extends("next/core-web-vitals", "next/typescript"),
  { rules: { "@typescript-eslint/no-explicit-any": "off", "@typescript-eslint/no-unused-expressions": "off", "@typescript-eslint/no-unused-vars": "off", "@next/next/no-html-link-for-pages": "off", "react/no-unescaped-entities": "off" } },
];
