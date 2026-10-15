# TypeScript 7 compatibility bridge

TypeScript 7 provides the `tsc` CLI but no stable JavaScript compiler API.
Next.js and `typescript-eslint` still load that API from the `typescript`
package.

This local package exposes the TypeScript 6 API from
`@typescript/typescript6` and forwards its `tsc` binary to TypeScript 7 through
`@typescript/native`. Remove the bridge once the framework and lint tooling can
consume the TypeScript 7 API directly.
