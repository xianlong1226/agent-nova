import { defineConfig } from 'tsup'

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm', 'cjs'],
  dts: false,  // consumers import types from sub-packages directly
  clean: true,
  sourcemap: true,
  external: [
    'ai', '@ai-sdk/openai', '@ai-sdk/anthropic', 'zod',
    '@agentnova/core', '@agentnova/tools', '@agentnova/permission',
    '@agentnova/memory', '@agentnova/skills', '@agentnova/providers',
  ],
})
