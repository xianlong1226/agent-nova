/**
 * Type-only consistency test for `@agentnova/contracts` → `@agentnova/tools` re-exports.
 *
 * Runs under `vitest --typecheck` (type-only file `*.test-d.ts`).
 * If any contract type is missing in `@agentnova/tools` (e.g. someone replaces the
 * `export type *` with a partial manual list) OR its shape diverges, the corresponding
 * `expectTypeOf(...).toEqualTypeOf<...>()` assertion produces a compile error and the
 * test fails.
 */
import { describe, test, expectTypeOf } from 'vitest'
import type * as Contracts from '@agentnova/contracts'
import type * as Tools from '../src/index.js'

describe('@agentnova/tools forwards every shared contract type', () => {
  test('permission types', () => {
    expectTypeOf<Contracts.PermissionLevel>().toEqualTypeOf<Tools.PermissionLevel>()
    expectTypeOf<Contracts.ToolPermission>().toEqualTypeOf<Tools.ToolPermission>()
    expectTypeOf<Contracts.PermissionMode>().toEqualTypeOf<Tools.PermissionMode>()
    expectTypeOf<Contracts.PermissionRule>().toEqualTypeOf<Tools.PermissionRule>()
    expectTypeOf<Contracts.PermissionConfig>().toEqualTypeOf<Tools.PermissionConfig>()
  })

  test('approval types', () => {
    expectTypeOf<Contracts.ApprovalRequest>().toEqualTypeOf<Tools.ApprovalRequest>()
    expectTypeOf<Contracts.ApprovalResult>().toEqualTypeOf<Tools.ApprovalResult>()
    expectTypeOf<Contracts.ApprovalFn>().toEqualTypeOf<Tools.ApprovalFn>()
  })

  test('sandbox / limits types', () => {
    expectTypeOf<Contracts.SandboxConfig>().toEqualTypeOf<Tools.SandboxConfig>()
    expectTypeOf<Contracts.ResourceLimits>().toEqualTypeOf<Tools.ResourceLimits>()
  })

  test('preflight types', () => {
    expectTypeOf<Contracts.ToolPreflight>().toEqualTypeOf<Tools.ToolPreflight>()
    expectTypeOf<Contracts.ToolPreflightCtx>().toEqualTypeOf<Tools.ToolPreflightCtx>()
    expectTypeOf<Contracts.PreflightResult>().toEqualTypeOf<Tools.PreflightResult>()
  })
})
