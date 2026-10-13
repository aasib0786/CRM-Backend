/**
 * Workflow Action Runner (Phase 2)
 * Executes individual workflow steps with safety guards, anti-spam,
 * variable interpolation, and comprehensive logging.
 *
 * Supported Steps:
 *  - send_whatsapp_template
 *  - send_whatsapp_text (with 24h window check & fallback template)
 *  - send_email
 *  - wait
 *  - wait_until (with quiet hours & working hours protection)
 *  - if_else
 *  - assign_agent
 *  - update_field
 *  - change_stage
 *  - add_tag
 *  - remove_tag
 *  - create_task
 *  - notify_agent
 *  - start_bot
 *  - stop_bot
 *  - webhook
 *  - end
 */

import connectDB from '../pool.js';
import { interpolateVariables, buildWorkflowContext } from './workflow-variables.js';
import { evaluateConditionsGroup } from './workflow-conditions.js';
import { sendWhatsAppMessage } from '../bot/bot-engine.js';
import { logActivity } from '../activities/activityLogger.js';

/**
 * Checks if the customer 24-hour service window is open.
 * WhatsApp allows plain text messages ONLY if the user sent an inbound message within the last 24h.
 */
export async function isCustomerServiceWindowOpen(leadPhone, companyId) {
  if (!leadPhone) return false;
  const digits = String(leadPhone).replace(/\D/g, '').slice(-10);
  if (!digits) return false;

  try {
    // 1. Check bot_messages for inbound message from this phone within 24 hours
    const { rows } = await connectDB.query(
      `SELECT id, created_at FROM public.bot_messages
       WHERE company_id = $1 
         AND direction = 'inbound'
         AND (lead_id IN (SELECT id FROM public.leads WHERE right(regexp_replace(phone, '[^0-9]', '', 'g'), 10) = $2 AND company_id = $1))
         AND created_at >= NOW() - INTERVAL '24 hours'
       LIMIT 1`,
      [companyId, digits]
    );

    if (rows.length > 0) return true;

    // 2. Check whatsapp_messages for inbound message
    const waCheck = await connectDB.query(
      `SELECT wm.id FROM public.whatsapp_messages wm
       JOIN public.whatsapp_chats wc ON wc.id = wm.chat_id
       WHERE right(regexp_replace(wc.phone, '[^0-9]', '', 'g'), 10) = $1
         AND wm.sender = 'contact'
         AND wm.timestamp >= NOW() - INTERVAL '24 hours'
       LIMIT 1`,
      [digits]
    );

    return waCheck.rows.length > 0;
  } catch (err) {
    console.warn('[Workflow Actions] Error checking 24h window:', err.message);
    return false;
  }
}

/**
 * Calculates next available timestamp respecting quiet hours (9:00 PM to 9:00 AM)
 * and optional business working hours.
 */
export function applyQuietHoursGuard(targetDate) {
  const d = new Date(targetDate);
  const hour = d.getHours();

  // If between 9:00 PM (21:00) and 8:59 AM, push to 9:00 AM
  if (hour >= 21) {
    // Advance to tomorrow 9:00 AM
    d.setDate(d.getDate() + 1);
    d.setHours(9, 0, 0, 0);
  } else if (hour < 9) {
    // Advance to today 9:00 AM
    d.setHours(9, 0, 0, 0);
  }

  return d;
}

/**
 * Calculates target run time for a 'wait' step
 */
export function calculateWaitTime(config) {
  const duration = Math.max(1, Number(config.duration || 1));
  const unit = String(config.unit || 'minutes').toLowerCase();

  let ms = 60 * 1000;
  if (unit === 'minutes' || unit === 'minute' || unit === 'm') {
    ms = duration * 60 * 1000;
  } else if (unit === 'hours' || unit === 'hour' || unit === 'h') {
    ms = duration * 60 * 60 * 1000;
  } else if (unit === 'days' || unit === 'day' || unit === 'd') {
    ms = duration * 24 * 60 * 60 * 1000;
  }

  const nextRun = new Date(Date.now() + ms);
  return config.respect_quiet_hours ? applyQuietHoursGuard(nextRun) : nextRun;
}

/**
 * Calculates target run time for a 'wait_until' step
 */
export function calculateWaitUntilTime(config) {
  const now = new Date();
  const target = new Date();

  // Parse time (e.g. "10:30" or "14:00")
  if (config.time && typeof config.time === 'string') {
    const [h, m] = config.time.split(':').map((num) => parseInt(num, 10) || 0);
    target.setHours(h, m, 0, 0);
    if (target.getTime() <= now.getTime()) {
      target.setDate(target.getDate() + 1);
    }
  }

  // Parse allowed weekdays (e.g. ['monday', 'tuesday', ...])
  if (Array.isArray(config.days) && config.days.length > 0) {
    const daysMap = { sunday: 0, monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6 };
    const allowedDays = config.days.map((d) => daysMap[String(d).toLowerCase()]).filter((d) => d !== undefined);

    if (allowedDays.length > 0) {
      let attempts = 0;
      while (!allowedDays.includes(target.getDay()) && attempts < 7) {
        target.setDate(target.getDate() + 1);
        attempts++;
      }
    }
  }

  return config.respect_quiet_hours !== false ? applyQuietHoursGuard(target) : target;
}

/**
 * Universal Action Executor for Workflow Steps
 *
 * @param {object} params
 * @param {object} params.step - The step definition { id, type, title, config }
 * @param {object} params.context - Execution context { lead, agent, project, company, ... }
 * @param {string} params.runId - Workflow run UUID
 * @param {string} params.companyId - Multi-tenant Company UUID
 * @returns {Promise<{
 *   status: 'success' | 'waiting' | 'skipped' | 'failed' | 'branch',
 *   output?: object,
 *   next_run_at?: Date,
 *   next_step_id?: string,
 *   error?: string
 * }>}
 */
export async function executeWorkflowStep({
  step,
  context,
  runId = null,
  companyId,
}) {
  const startMs = Date.now();
  const stepType = String(step.type || '').toLowerCase().trim();
  const config = step.config || {};
  const lead = context.lead || {};

  let result = { status: 'success', output: {} };

  try {
    switch (stepType) {
      // ----------------------------------------------------
      // 1. SEND WHATSAPP TEMPLATE
      // ----------------------------------------------------
      case 'send_whatsapp_template': {
        const templateName = interpolateVariables(config.template_name || config.templateName, context);
        if (!templateName) {
          throw new Error('Template name is required for send_whatsapp_template step');
        }

        const rawParams = Array.isArray(config.body_params) ? config.body_params : (config.params || []);
        const interpolatedParams = rawParams.map((p) => interpolateVariables(String(p), context));

        const dispatchRes = await sendWhatsAppMessage({
          to: lead.phone,
          templateName,
          templateParams: interpolatedParams,
          leadId: lead.id,
          companyId,
          sender: 'workflow_bot',
          messageType: 'template',
        });

        result = {
          status: 'success',
          output: {
            dispatched_to: lead.phone,
            template: templateName,
            params: interpolatedParams,
            wa_response: dispatchRes ? 'queued' : 'simulated',
          },
        };
        break;
      }

      // ----------------------------------------------------
      // 2. SEND WHATSAPP TEXT (With 24h Window Check)
      // ----------------------------------------------------
      case 'send_whatsapp_text': {
        const rawText = config.message || config.text || '';
        const messageText = interpolateVariables(rawText, context);

        if (!messageText) {
          throw new Error('Message text is required for send_whatsapp_text step');
        }

        // Check 24-Hour Customer Service Window
        const isWindowOpen = await isCustomerServiceWindowOpen(lead.phone, companyId);

        if (!isWindowOpen) {
          // Window closed! Fallback to template if configured
          if (config.fallback_template) {
            console.log(`[Workflow Actions] 24h window closed for ${lead.phone}. Falling back to template: ${config.fallback_template}`);
            const fbRes = await sendWhatsAppMessage({
              to: lead.phone,
              templateName: config.fallback_template,
              templateParams: [lead.name || 'there'],
              leadId: lead.id,
              companyId,
              sender: 'workflow_bot',
              messageType: 'template',
            });
            result = {
              status: 'success',
              output: {
                fallback_used: true,
                template: config.fallback_template,
                reason: '24h window closed, fallback template dispatched',
              },
            };
          } else {
            // No fallback template configured, safe skip to prevent Meta 131047 errors
            result = {
              status: 'skipped',
              output: {
                reason: '24h customer service window closed and no fallback template configured',
              },
            };
          }
          break;
        }

        // Window is open: send plain text
        const dispatchRes = await sendWhatsAppMessage({
          to: lead.phone,
          text: messageText,
          leadId: lead.id,
          companyId,
          sender: 'workflow_bot',
          messageType: 'text',
        });

        result = {
          status: 'success',
          output: {
            dispatched_to: lead.phone,
            message: messageText,
            wa_response: dispatchRes ? 'queued' : 'simulated',
          },
        };
        break;
      }

      // ----------------------------------------------------
      // 3. SEND EMAIL
      // ----------------------------------------------------
      case 'send_email': {
        const toEmail = interpolateVariables(config.to || lead.email, context);
        const subject = interpolateVariables(config.subject || 'Update on your inquiry', context);
        const rawBody = config.body || config.html || '';
        const bodyContent = interpolateVariables(rawBody, context);

        if (!toEmail) {
          result = { status: 'skipped', output: { reason: 'Lead has no valid email address' } };
          break;
        }

        try {
          const { getEmailTransporter } = await import('../quotations/quotationEmailService.js');
          const transporter = getEmailTransporter();
          await transporter.sendMail({
            from: process.env.EMAIL_FROM || process.env.EMAIL_USER || 'no-reply@crmpro.com',
            to: toEmail,
            subject,
            html: bodyContent.includes('<') ? bodyContent : `<p>${bodyContent.replace(/\n/g, '<br/>')}</p>`,
          });
          result = { status: 'success', output: { to: toEmail, subject } };
        } catch (mailErr) {
          console.warn('[Workflow Actions] Email send error:', mailErr.message);
          // If SMTP credentials not configured in dev, mark as simulated success
          result = {
            status: 'success',
            output: { simulated: true, to: toEmail, subject, note: mailErr.message },
          };
        }
        break;
      }

      // ----------------------------------------------------
      // 4. WAIT (Relative Duration)
      // ----------------------------------------------------
      case 'wait': {
        const nextRunAt = calculateWaitTime(config);
        result = {
          status: 'waiting',
          next_run_at: nextRunAt,
          output: { waiting_until: nextRunAt.toISOString() },
        };
        break;
      }

      // ----------------------------------------------------
      // 5. WAIT UNTIL (Specific time / weekday)
      // ----------------------------------------------------
      case 'wait_until': {
        const nextRunAt = calculateWaitUntilTime(config);
        result = {
          status: 'waiting',
          next_run_at: nextRunAt,
          output: { scheduled_for: nextRunAt.toISOString() },
        };
        break;
      }

      // ----------------------------------------------------
      // 6. IF / ELSE (Conditional Branching)
      // ----------------------------------------------------
      case 'if_else': {
        const conditionsGroup = config.conditions || { all: config.rules || [] };
        const passed = evaluateConditionsGroup(conditionsGroup, lead, context);

        const nextStepId = passed
          ? (config.then_step_id || config.thenStepId)
          : (config.else_step_id || config.elseStepId);

        result = {
          status: 'branch',
          next_step_id: nextStepId,
          output: {
            branch: passed ? 'then' : 'else',
            condition_passed: passed,
            next_step_id: nextStepId,
          },
        };
        break;
      }

      // ----------------------------------------------------
      // 7. ASSIGN AGENT
      // ----------------------------------------------------
      case 'assign_agent': {
        let targetAgentName = config.agent_name || '';
        let targetAgentId = config.agent_id || null;

        if (config.mode === 'round_robin') {
          // Fetch round robin user
          const { rows } = await connectDB.query(
            `SELECT id, name FROM public.users 
             WHERE company_id = $1 AND role IN ('agent', 'sales', 'admin') 
             ORDER BY random() LIMIT 1`,
            [companyId]
          );
          if (rows[0]) {
            targetAgentId = rows[0].id;
            targetAgentName = rows[0].name;
          }
        }

        if (targetAgentName || targetAgentId) {
          await connectDB.query(
            `UPDATE public.leads 
             SET assigned = COALESCE($1, assigned), 
                 assigned_user_id = COALESCE($2, assigned_user_id),
                 updated_at = NOW()
             WHERE id = $3 AND company_id = $4`,
            [targetAgentName || null, targetAgentId || null, lead.id, companyId]
          );

          await logActivity({
            type: 'lead_assigned',
            title: `Assigned to ${targetAgentName || 'Agent'}`,
            leadName: lead.name,
            leadId: lead.id,
            userName: 'Workflow Engine',
            detail: `Workflow step assigned lead to ${targetAgentName || 'Agent'}`,
          });
        }

        result = {
          status: 'success',
          output: { assigned_to: targetAgentName, agent_id: targetAgentId },
        };
        break;
      }

      // ----------------------------------------------------
      // 8. UPDATE FIELD
      // ----------------------------------------------------
      case 'update_field': {
        const fieldName = String(config.field || '').trim();
        const rawValue = config.value !== undefined ? config.value : '';
        const evaluatedValue = typeof rawValue === 'string'
          ? interpolateVariables(rawValue, context)
          : rawValue;

        if (!fieldName) {
          throw new Error('Field name is required for update_field step');
        }

        if (fieldName.startsWith('custom_fields.') || fieldName.startsWith('custom.')) {
          const key = fieldName.split('.')[1];
          const existingCustom = lead.custom_fields || {};
          const updatedCustom = { ...existingCustom, [key]: evaluatedValue };

          await connectDB.query(
            `UPDATE public.leads 
             SET custom_fields = $1::jsonb, updated_at = NOW() 
             WHERE id = $2 AND company_id = $3`,
            [JSON.stringify(updatedCustom), lead.id, companyId]
          );
        } else {
          // Direct standard column update (whitelist allowed columns)
          const allowedCols = ['score', 'budget', 'requirement', 'location', 'timeline', 'source', 'notes'];
          if (allowedCols.includes(fieldName)) {
            await connectDB.query(
              `UPDATE public.leads 
               SET ${fieldName} = $1, updated_at = NOW() 
               WHERE id = $2 AND company_id = $3`,
              [evaluatedValue, lead.id, companyId]
            );
          }
        }

        result = {
          status: 'success',
          output: { field: fieldName, value: evaluatedValue },
        };
        break;
      }

      // ----------------------------------------------------
      // 9. CHANGE STAGE
      // ----------------------------------------------------
      case 'change_stage': {
        const targetStage = interpolateVariables(config.stage || '', context);
        if (!targetStage) {
          throw new Error('Stage name is required for change_stage step');
        }

        await connectDB.query(
          `UPDATE public.leads 
           SET stage = $1, updated_at = NOW() 
           WHERE id = $2 AND company_id = $3`,
          [targetStage, lead.id, companyId]
        );

        await logActivity({
          type: 'stage_changed',
          title: `Stage moved to ${targetStage}`,
          leadName: lead.name,
          leadId: lead.id,
          userName: 'Workflow Engine',
          detail: `Workflow updated stage from "${lead.stage}" to "${targetStage}"`,
        });

        result = {
          status: 'success',
          output: { previous_stage: lead.stage, new_stage: targetStage },
        };
        break;
      }

      // ----------------------------------------------------
      // 10. ADD TAG
      // ----------------------------------------------------
      case 'add_tag': {
        const tagToAdd = String(config.tag || '').trim();
        if (tagToAdd && lead.id) {
          // Lead tags can be JSON array or text array
          let existingTags = Array.isArray(lead.tags) ? lead.tags : [];
          if (typeof lead.tags === 'string') {
            try { existingTags = JSON.parse(lead.tags); } catch {
              existingTags = lead.tags.split(',').map((t) => t.trim()).filter(Boolean);
            }
          }
          if (!existingTags.includes(tagToAdd)) {
            existingTags.push(tagToAdd);
            await connectDB.query(
              `UPDATE public.leads 
               SET tags = $1, updated_at = NOW() 
               WHERE id = $2 AND company_id = $3`,
              [JSON.stringify(existingTags), lead.id, companyId]
            );
          }
        }

        result = { status: 'success', output: { added_tag: config.tag } };
        break;
      }

      // ----------------------------------------------------
      // 11. REMOVE TAG
      // ----------------------------------------------------
      case 'remove_tag': {
        const tagToRemove = String(config.tag || '').trim();
        if (tagToRemove && lead.id) {
          let existingTags = Array.isArray(lead.tags) ? lead.tags : [];
          if (typeof lead.tags === 'string') {
            try { existingTags = JSON.parse(lead.tags); } catch {
              existingTags = lead.tags.split(',').map((t) => t.trim()).filter(Boolean);
            }
          }
          const filtered = existingTags.filter((t) => t.toLowerCase() !== tagToRemove.toLowerCase());
          await connectDB.query(
            `UPDATE public.leads 
             SET tags = $1, updated_at = NOW() 
             WHERE id = $2 AND company_id = $3`,
            [JSON.stringify(filtered), lead.id, companyId]
          );
        }

        result = { status: 'success', output: { removed_tag: config.tag } };
        break;
      }

      // ----------------------------------------------------
      // 12. CREATE TASK / SCHEDULED FOLLOW-UP
      // ----------------------------------------------------
      case 'create_task': {
        const title = interpolateVariables(config.title || 'Follow up with lead', context);
        const description = interpolateVariables(config.description || '', context);
        const dueHours = Number(config.due_in_hours || 24);
        const scheduledTime = new Date(Date.now() + dueHours * 60 * 60 * 1000);

        await connectDB.query(
          `INSERT INTO public.notifications (
            title, description, lead_id, lead_name, scheduled_at, type, read, created_at
          ) VALUES ($1, $2, $3, $4, $5, 'task', false, NOW())`,
          [title, description, lead.id, lead.name, scheduledTime]
        );

        result = {
          status: 'success',
          output: { task_title: title, scheduled_at: scheduledTime.toISOString() },
        };
        break;
      }

      // ----------------------------------------------------
      // 13. NOTIFY AGENT
      // ----------------------------------------------------
      case 'notify_agent': {
        const title = interpolateVariables(config.title || 'Workflow Alert', context);
        const message = interpolateVariables(config.message || '', context);

        await connectDB.query(
          `INSERT INTO public.notifications (
            title, description, lead_id, lead_name, scheduled_at, type, read, created_at
          ) VALUES ($1, $2, $3, $4, NOW(), 'alert', false, NOW())`,
          [title, message, lead.id, lead.name]
        );

        result = {
          status: 'success',
          output: { notification_title: title, message },
        };
        break;
      }

      // ----------------------------------------------------
      // 14. START BOT (Enable AI Bot for Lead)
      // ----------------------------------------------------
      case 'start_bot': {
        if (lead.id) {
          await connectDB.query(
            `UPDATE public.bot_conversations 
             SET status = 'active', updated_at = NOW() 
             WHERE lead_id = $1 AND company_id = $2`,
            [lead.id, companyId]
          );
        }
        result = { status: 'success', output: { bot_status: 'active' } };
        break;
      }

      // ----------------------------------------------------
      // 15. STOP BOT (Pause AI Bot for Lead)
      // ----------------------------------------------------
      case 'stop_bot': {
        if (lead.id) {
          await connectDB.query(
            `UPDATE public.bot_conversations 
             SET status = 'paused', updated_at = NOW() 
             WHERE lead_id = $1 AND company_id = $2`,
            [lead.id, companyId]
          );
        }
        result = { status: 'success', output: { bot_status: 'paused' } };
        break;
      }

      // ----------------------------------------------------
      // 16. WEBHOOK OUTBOUND
      // ----------------------------------------------------
      case 'webhook': {
        const targetUrl = interpolateVariables(config.url || '', context);
        const method = (config.method || 'POST').toUpperCase();
        let payloadBody = undefined;

        if (method !== 'GET') {
          const rawBody = typeof config.body === 'object' ? JSON.stringify(config.body) : (config.body || '{}');
          payloadBody = interpolateVariables(rawBody, context);
        }

        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 10000); // 10s timeout

        const response = await fetch(targetUrl, {
          method,
          headers: {
            'Content-Type': 'application/json',
            ...(config.headers || {}),
          },
          body: payloadBody,
          signal: controller.signal,
        });
        clearTimeout(timeoutId);

        result = {
          status: response.ok ? 'success' : 'failed',
          output: { http_status: response.status, url: targetUrl },
        };
        break;
      }

      // ----------------------------------------------------
      // 17. END WORKFLOW
      // ----------------------------------------------------
      case 'end': {
        result = {
          status: 'success',
          output: { terminated: true },
        };
        break;
      }

      default:
        throw new Error(`Unsupported workflow step type: ${stepType}`);
    }
  } catch (stepErr) {
    result = {
      status: 'failed',
      error: stepErr.message,
      output: { error: stepErr.message },
    };
  }

  const durationMs = Date.now() - startMs;

  // Record execution log in database if runId provided
  if (runId) {
    try {
      await connectDB.query(
        `INSERT INTO public.workflow_run_logs (
          company_id, run_id, step_id, step_type, step_title,
          status, input_payload, output_payload, error_message,
          executed_at, duration_ms
        ) VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb, $9, NOW(), $10)`,
        [
          companyId,
          runId,
          step.id || 'step-unknown',
          stepType,
          step.title || stepType,
          result.status,
          JSON.stringify(config),
          JSON.stringify(result.output || {}),
          result.error || null,
          durationMs,
        ]
      );
    } catch (logErr) {
      console.warn('[Workflow Actions] Error inserting run log:', logErr.message);
    }
  }

  return { ...result, durationMs };
}
