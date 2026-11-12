import { describe, expect, it } from 'vitest';
import { analyzePhoto, findDuplicates, runClaimChecksTask } from './tasks.js';

describe('workflow tasks', () => {
  it('registers the root task and its two subtasks', () => {
    for (const t of [runClaimChecksTask, analyzePhoto, findDuplicates]) expect(t).toBeDefined();
  });
});
