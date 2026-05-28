import { defineConfig } from 'tsup'

export default defineConfig((options) => ({
  entry: ['src/index.ts', 'src/cli.ts'],
  format: ['esm', 'cjs'],
  dts: {
    resolve: ['@agentnova/core', '@agentnova/tools', '@agentnova/permission', '@agentnova/memory', '@agentnova/skills', '@agentnova/providers'],
  },
  clean: !options.watch,
  sourcemap: true,
  external: [
    'ai', '@ai-sdk/openai', '@ai-sdk/anthropic', 'zod',
    '@agentnova/core', '@agentnova/tools', '@agentnova/permission',
    '@agentnova/memory', '@agentnova/skills', '@agentnova/providers',
  ],
}))
