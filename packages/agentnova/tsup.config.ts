import { defineConfig } from 'tsup'

export default defineConfig({
  entry: ['src/index.ts', 'src/cli.ts'],
  format: ['esm', 'cjs'],
  dts: {
    resolve: ['@agentnova/core', '@agentnova/tools', '@agentnova/permission', '@agentnova/memory', '@agentnova/skills', '@agentnova/providers'],
  },
  clean: true,
  sourcemap: true,
  external: [
    'ai', '@ai-sdk/openai', '@ai-sdk/anthropic', 'zod',
    '@agentnova/core', '@agentnova/tools', '@agentnova/permission',
    '@agentnova/memory', '@agentnova/skills', '@agentnova/providers',
  ],
})
