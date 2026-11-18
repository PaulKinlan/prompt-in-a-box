/**
 * Force Zod v4 into jitless mode for Chrome Extension MV3 CSP compliance.
 *
 * Extension pages and service workers enforce `script-src 'self'` without
 * `'unsafe-eval'`. Without `jitless: true`, Zod v4 probes `new Function("")`
 * on first schema initialization (`allowsEval`), which Chromium blocks and
 * records as a CSP violation (`Hash of blocked script: "eval-sha256-..."`)
 * even though Zod catches the resulting EvalError.
 */
(globalThis as Record<string, unknown>).__zod_globalConfig = Object.assign(
  ((globalThis as Record<string, unknown>).__zod_globalConfig as Record<string, unknown>) || {},
  { jitless: true },
);

import { z } from 'zod';

z.config({ jitless: true });
