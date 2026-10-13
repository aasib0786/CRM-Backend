/**
 * Workflow Trigger Evaluator (Phase 2)
 * Matches trigger events against workflow definitions.
 *
 * Supported Trigger Types:
 *  - lead_created
 *  - stage_changed
 *  - lead_assigned
 *  - score_crossed
 *  - tag_added
 *  - no_reply_for
 *  - followup_due
 *  - bot_handed_off
 *  - field_updated
 *  - manual
 */

import { evaluateConditionsGroup } from './workflow-conditions.js';
import { buildWorkflowContext } from './workflow-variables.js';

/**
 * Normalizes an array or scalar into a lowercased string array
 */
function toNormalizedList(val) {
  if (!val) return [];
  if (Array.isArray(val)) {
    return val.map((v) => String(v).toLowerCase().trim()).filter(Boolean);
  }
  if (typeof val === 'string') {
    return val
      .split(',')
      .map((v) => v.toLowerCase().trim())
      .filter(Boolean);
  }
  return [String(val).toLowerCase().trim()];
}

/**
 * Checks whether an event matches the trigger configuration of a workflow.
 *
 * @param {object} workflow - Workflow record with trigger_type and trigger_config
 * @param {object} triggerEvent - Event payload
 *  {
 *    type: 'lead_created' | 'stage_changed' | ...,
 *    company_id: string,
 *    lead: object,
 *    previousLead?: object,
 *    payload?: object (e.g. { from_stage, to_stage, tag, field, oldValue, newValue, score, previousScore, hours_inactive, reason }),
 *    userId?: string
 *  }
 * @returns {{ matches: boolean, reason?: string }}
 */
export function matchTrigger(workflow, triggerEvent) {
  if (!workflow || !triggerEvent) {
    return { matches: false, reason: 'Invalid workflow or trigger event' };
  }

  // Workflows must be active to trigger (unless manually invoked)
  if (workflow.is_active === false && triggerEvent.type !== 'manual') {
    return { matches: false, reason: 'Workflow is paused or inactive' };
  }

  // Trigger type must match
  if (workflow.trigger_type !== triggerEvent.type) {
    return {
      matches: false,
      reason: `Trigger type mismatch: expected ${workflow.trigger_type}, got ${triggerEvent.type}`,
    };
  }

  const config = workflow.trigger_config || {};
  const lead = triggerEvent.lead || {};
  const prevLead = triggerEvent.previousLead || {};
  const payload = triggerEvent.payload || {};

  switch (workflow.trigger_type) {
    // ----------------------------------------------------
    // 1. LEAD CREATED
    // ----------------------------------------------------
    case 'lead_created': {
      // Optional source filter
      const allowedSources = toNormalizedList(config.sources || config.source);
      if (allowedSources.length > 0) {
        const leadSource = String(lead.source || '').toLowerCase().trim();
        if (!allowedSources.includes(leadSource) && !allowedSources.includes('any')) {
          return { matches: false, reason: `Lead source "${lead.source}" not in allowed sources` };
        }
      }

      // Optional project filter
      const allowedProjects = toNormalizedList(config.projects || config.project_id || config.project);
      if (allowedProjects.length > 0) {
        const leadProj = String(lead.project_id || lead.project || '').toLowerCase().trim();
        if (!allowedProjects.includes(leadProj) && !allowedProjects.includes('any')) {
          return { matches: false, reason: `Lead project does not match configured projects` };
        }
      }

      return { matches: true };
    }

    // ----------------------------------------------------
    // 2. STAGE CHANGED
    // ----------------------------------------------------
    case 'stage_changed': {
      const fromStage = (payload.from_stage || prevLead.stage || '').toLowerCase().trim();
      const toStage = (payload.to_stage || lead.stage || '').toLowerCase().trim();

      // Check 'from_stage' filter if specified
      if (config.from_stage && String(config.from_stage).toLowerCase() !== 'any') {
        const expectedFrom = String(config.from_stage).toLowerCase().trim();
        if (fromStage !== expectedFrom) {
          return {
            matches: false,
            reason: `From stage "${fromStage}" does not match required "${expectedFrom}"`,
          };
        }
      }

      // Check 'to_stage' filter if specified
      if (config.to_stage && String(config.to_stage).toLowerCase() !== 'any') {
        const expectedTo = String(config.to_stage).toLowerCase().trim();
        if (toStage !== expectedTo) {
          return {
            matches: false,
            reason: `To stage "${toStage}" does not match required "${expectedTo}"`,
          };
        }
      }

      return { matches: true };
    }

    // ----------------------------------------------------
    // 3. LEAD ASSIGNED
    // ----------------------------------------------------
    case 'lead_assigned': {
      const assignedUser = String(
        payload.agent_id || payload.assigned_id || lead.assigned_user_id || lead.assigned || ''
      ).toLowerCase().trim();

      if (config.agent_id && String(config.agent_id).toLowerCase() !== 'any') {
        const expectedAgent = String(config.agent_id).toLowerCase().trim();
        if (assignedUser !== expectedAgent) {
          return { matches: false, reason: `Assigned agent does not match configured target` };
        }
      }

      return { matches: true };
    }

    // ----------------------------------------------------
    // 4. SCORE CROSSED
    // ----------------------------------------------------
    case 'score_crossed': {
      const threshold = Number(config.threshold ?? 50);
      const direction = String(config.direction || 'above').toLowerCase();
      const newScore = Number(payload.score ?? lead.score ?? 0);
      const prevScore = payload.previousScore !== undefined
        ? Number(payload.previousScore)
        : (prevLead.score !== undefined ? Number(prevLead.score) : undefined);

      if (direction === 'above') {
        // Crossed above threshold: currently >= threshold and previously < threshold (or new)
        const crossed = newScore >= threshold && (prevScore === undefined || prevScore < threshold);
        if (!crossed) {
          return {
            matches: false,
            reason: `Score ${newScore} did not cross above threshold ${threshold} (prev: ${prevScore})`,
          };
        }
      } else if (direction === 'below') {
        // Crossed below threshold
        const crossed = newScore <= threshold && (prevScore === undefined || prevScore > threshold);
        if (!crossed) {
          return {
            matches: false,
            reason: `Score ${newScore} did not cross below threshold ${threshold} (prev: ${prevScore})`,
          };
        }
      } else {
        // 'any' direction
        if (newScore !== threshold) {
          return { matches: false, reason: `Score ${newScore} does not match threshold ${threshold}` };
        }
      }

      return { matches: true };
    }

    // ----------------------------------------------------
    // 5. TAG ADDED
    // ----------------------------------------------------
    case 'tag_added': {
      const addedTags = toNormalizedList(payload.tag || payload.tags);
      const targetTags = toNormalizedList(config.tag || config.tags);

      if (targetTags.length > 0) {
        const matchesAny = targetTags.some((t) => addedTags.includes(t));
        if (!matchesAny) {
          return {
            matches: false,
            reason: `Added tag(s) [${addedTags.join(', ')}] do not include configured tag(s)`,
          };
        }
      }

      return { matches: true };
    }

    // ----------------------------------------------------
    // 6. NO REPLY FOR
    // ----------------------------------------------------
    case 'no_reply_for': {
      const reqHours = Number(config.duration_hours || config.hours || 24);
      const hoursInactive = Number(payload.hours_inactive || 0);

      if (hoursInactive < reqHours) {
        return {
          matches: false,
          reason: `Lead inactive for ${hoursInactive}h, requires ${reqHours}h`,
        };
      }

      return { matches: true };
    }

    // ----------------------------------------------------
    // 7. FOLLOW-UP DUE
    // ----------------------------------------------------
    case 'followup_due': {
      // Due events are generated when follow-up time is reached or past
      return { matches: true };
    }

    // ----------------------------------------------------
    // 8. BOT HANDED OFF
    // ----------------------------------------------------
    case 'bot_handed_off': {
      if (config.reason && String(config.reason).toLowerCase() !== 'any') {
        const expectedReason = String(config.reason).toLowerCase();
        const actualReason = String(payload.reason || '').toLowerCase();
        if (!actualReason.includes(expectedReason)) {
          return {
            matches: false,
            reason: `Handoff reason "${actualReason}" does not match "${expectedReason}"`,
          };
        }
      }
      return { matches: true };
    }

    // ----------------------------------------------------
    // 9. FIELD UPDATED
    // ----------------------------------------------------
    case 'field_updated': {
      const targetField = String(config.field || '').toLowerCase().trim();
      const updatedField = String(payload.field || '').toLowerCase().trim();

      if (targetField && updatedField !== targetField) {
        return {
          matches: false,
          reason: `Updated field "${updatedField}" does not match configured "${targetField}"`,
        };
      }

      if (config.new_value !== undefined && config.new_value !== null && config.new_value !== '') {
        const expNew = String(config.new_value).toLowerCase().trim();
        const actNew = String(payload.newValue ?? payload.value ?? '').toLowerCase().trim();
        if (expNew !== actNew) {
          return {
            matches: false,
            reason: `New value "${actNew}" does not match expected "${expNew}"`,
          };
        }
      }

      return { matches: true };
    }

    // ----------------------------------------------------
    // 10. MANUAL
    // ----------------------------------------------------
    case 'manual': {
      return { matches: true };
    }

    default:
      return { matches: false, reason: `Unknown trigger type: ${workflow.trigger_type}` };
  }
}

/**
 * Checks complete eligibility of a workflow for a trigger event:
 * 1. Checks trigger match
 * 2. Builds context
 * 3. Evaluates workflow conditions group (all/any)
 *
 * @returns {Promise<{ eligible: boolean, reason?: string, context?: object }>}
 */
export async function evaluateWorkflowEligibility(workflow, triggerEvent, prebuiltContext = null) {
  // 1. Check trigger match
  const triggerMatch = matchTrigger(workflow, triggerEvent);
  if (!triggerMatch.matches) {
    return { eligible: false, reason: triggerMatch.reason };
  }

  // 2. Build execution context
  const context = prebuiltContext || (await buildWorkflowContext({
    companyId: workflow.company_id || triggerEvent.company_id,
    leadId: triggerEvent.lead?.id,
    lead: triggerEvent.lead,
    extraContext: {
      event: {
        type: triggerEvent.type,
        payload: triggerEvent.payload || {},
      },
    },
  }));

  // 3. Evaluate conditional rules (all/any)
  if (workflow.conditions && typeof workflow.conditions === 'object') {
    const conditionsPassed = evaluateConditionsGroup(
      workflow.conditions,
      context.lead,
      context
    );

    if (!conditionsPassed) {
      return {
        eligible: false,
        reason: 'Workflow conditions (filters) were not satisfied by lead',
        context,
      };
    }
  }

  return { eligible: true, context };
}
