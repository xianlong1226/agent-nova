import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // Enable TypeScript-level assertions in `*.test-d.ts` files.
    // Used by test/forward-types.test-d.ts to guarantee
    // @agentnova/tools re-exports stay structurally identical to @agentnova/contracts.
    typecheck: {
      enabled: true,
      tsconfig: './tsconfig.test.json',
    },
  },
})
