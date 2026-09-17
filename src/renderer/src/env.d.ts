/// <reference types="vite/client" />

// Vite's client typings declare ambient modules for '*.css' (and other asset
// imports) and type import.meta.env for the renderer bundle. With
// "noUncheckedSideEffectImports" enabled in tsconfig.json, the side-effect
// CSS imports in main.tsx are resolved through these declarations.
