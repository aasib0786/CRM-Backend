/**
 * Workflow Background Scheduler Worker (Phase 3)
 * Polls delayed/waiting workflow runs using SELECT ... FOR UPDATE SKIP LOCKED
 * Safe for PM2 clusters and multi-instance distributed deployments.
 */

import connectDB from '../pool.js';
import { runWorkflowExecution } from './workflow-engine.js';

let schedulerTimer = null;
let isProcessing = false;

/**
 * Polls and processes waiting workflow runs whose next_run_at has arrived
 */
export async function pollAndExecuteWaitingRuns(batchSize = 10) {
  if (isProcessing) return; // Prevent overlapping polls in the same node process
  isProcessing = true;

  const client = await connectDB.connect();

  try {
    // 1. Begin transaction to safely lock candidate rows
    await client.query('BEGIN');

    // 2. Lock candidate rows with SKIP LOCKED for cluster safety
    const { rows: dueRuns } = await client.query(
      `SELECT id, company_id, current_step_index
       FROM public.workflow_runs
       WHERE status = 'waiting'
         AND next_run_at <= NOW()
       ORDER BY next_run_at ASC
       LIMIT $1
       FOR UPDATE SKIP LOCKED`,
      [batchSize]
    );

    if (dueRuns.length > 0) {
      const ids = dueRuns.map((r) => r.id);

      // 3. Mark selected runs as 'running' inside the transaction
      await client.query(
        `UPDATE public.workflow_runs 
         SET status = 'running', updated_at = NOW() 
         WHERE id = ANY($1::uuid[])`,
        [ids]
      );

      // Commit transaction immediately to release DB lock, runs are now marked 'running'
      await client.query('COMMIT');

      // 4. Dispatch runs asynchronously
      for (const run of dueRuns) {
        runWorkflowExecution(run.id).catch((err) => {
          console.error(`[Workflow Scheduler] Error executing resumed run ${run.id}:`, err);
        });
      }
    } else {
      await client.query('COMMIT');
    }
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('[Workflow Scheduler] Polling error:', err.message);
  } finally {
    client.release();
    isProcessing = false;
  }
}

/**
 * Starts the background polling worker
 *
 * @param {number} intervalMs - Polling interval in ms (default 15000ms = 15s)
 */
export function startWorkflowScheduler(intervalMs = 15000) {
  if (schedulerTimer) {
    console.log('[Workflow Scheduler] Already running.');
    return;
  }

  console.log(`[Workflow Scheduler] Started background worker (poll interval: ${intervalMs / 1000}s, cluster-safe FOR UPDATE SKIP LOCKED)`);

  // Initial immediate poll
  setTimeout(() => {
    pollAndExecuteWaitingRuns().catch((e) => console.warn('[Workflow Scheduler] Initial poll error:', e.message));
  }, 2000);

  // Recurring polling
  schedulerTimer = setInterval(() => {
    pollAndExecuteWaitingRuns().catch((e) => {
      console.warn('[Workflow Scheduler] Poll error:', e.message);
    });
  }, intervalMs);
}

/**
 * Stops the background scheduler worker
 */
export function stopWorkflowScheduler() {
  if (schedulerTimer) {
    clearInterval(schedulerTimer);
    schedulerTimer = null;
    console.log('[Workflow Scheduler] Stopped.');
  }
}
