import { defineConfig, globalIgnores } from 'eslint/config'
import nextVitals from 'eslint-config-next/core-web-vitals'

export default defineConfig([
  ...nextVitals,
  {
    // React Compiler is not enabled. Keep the existing effect-based loading and
    // reset flows during this security migration; Rules of Hooks remain enabled.
    rules: { 'react-hooks/set-state-in-effect': 'off' },
  },
  globalIgnores(['.next/**', 'out/**', 'node_modules/**', 'next-env.d.ts']),
])
