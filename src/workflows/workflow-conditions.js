/**
 * Workflow Condition Evaluator (Phase 2)
 * Evaluates grouped conditions (all / any) against a lead record.
 *
 * Supported Fields:
 *  - source, stage, score, tag, assigned_agent, project,
 *  - custom_field_value, has_whatsapp_number, created_within_x_days
 *
 * Supported Operators:
 *  - equals / is, not_equals / is_not
 *  - contains, not_contains
 *  - greater_than / gt, less_than / lt, gte, lte
 *  - in, not_in
 *  - is_empty, is_set
 *  - between
 */

/**
 * Normalizes phone numbers to clean international digits
 */
function cleanPhoneDigits(phone) {
  if (!phone) return '';
  return String(phone).replace(/\D/g, '');
}

/**
 * Evaluates a single rule condition against the lead
 */
export function evaluateConditionRule(lead, rule, context = {}) {
  if (!rule || !lead) return true;

  const field = String(rule.field || '').toLowerCase().trim();
  const operator = String(rule.operator || 'equals').toLowerCase().trim();
  const ruleVal = rule.value;

  // 1. Resolve actual lead value
  let actualVal = undefined;

  switch (field) {
    case 'source':
      actualVal = lead.source || '';
      break;

    case 'stage':
      actualVal = lead.stage || '';
      break;

    case 'score':
      actualVal = Number(lead.score || 0);
      break;

    case 'tag':
    case 'tags': {
      let leadTags = [];
      if (Array.isArray(lead.tags)) {
        leadTags = lead.tags;
      } else if (typeof lead.tags === 'string') {
        try { leadTags = JSON.parse(lead.tags); } catch {
          leadTags = lead.tags.split(',').map((t) => t.trim());
        }
      }
      actualVal = leadTags;
      break;
    }

    case 'assigned_agent':
    case 'assigned':
      actualVal = lead.assigned || lead.assigned_to || '';
      break;

    case 'project':
    case 'project_id':
      actualVal = lead.project_id || (context.project?.name || '');
      break;

    case 'has_whatsapp_number': {
      const digits = cleanPhoneDigits(lead.phone);
      actualVal = digits.length >= 10;
      break;
    }

    case 'created_within_x_days': {
      if (!lead.created_at) return false;
      const createdAt = new Date(lead.created_at);
      const diffMs = Date.now() - createdAt.getTime();
      const diffDays = diffMs / (1000 * 60 * 60 * 24);
      actualVal = diffDays;
      break;
    }

    case 'custom_field':
    case 'custom_field_value': {
      const customKey = rule.custom_field || rule.key || rule.custom_key;
      const customFields = lead.custom_fields || {};
      actualVal = customKey ? customFields[customKey] : undefined;
      break;
    }

    default:
      // Direct property lookup or custom field fallback
      if (lead[rule.field] !== undefined) {
        actualVal = lead[rule.field];
      } else if (lead.custom_fields && lead.custom_fields[rule.field] !== undefined) {
        actualVal = lead.custom_fields[rule.field];
      } else {
        actualVal = '';
      }
      break;
  }

  // 2. Evaluate operator
  const strActual = actualVal !== null && actualVal !== undefined ? String(actualVal).toLowerCase().trim() : '';
  const strRule = ruleVal !== null && ruleVal !== undefined ? String(ruleVal).toLowerCase().trim() : '';

  switch (operator) {
    case 'equals':
    case 'is':
    case '==':
    case '===':
      if (field === 'has_whatsapp_number') {
        return Boolean(actualVal) === (strRule === 'true' || ruleVal === true);
      }
      if (field === 'score') {
        return Number(actualVal) === Number(ruleVal);
      }
      return strActual === strRule;

    case 'not_equals':
    case 'is_not':
    case '!=':
    case '!==':
      if (field === 'has_whatsapp_number') {
        return Boolean(actualVal) !== (strRule === 'true' || ruleVal === true);
      }
      return strActual !== strRule;

    case 'contains':
      if (Array.isArray(actualVal)) {
        return actualVal.some((item) => String(item).toLowerCase().includes(strRule));
      }
      return strActual.includes(strRule);

    case 'not_contains':
      if (Array.isArray(actualVal)) {
        return !actualVal.some((item) => String(item).toLowerCase().includes(strRule));
      }
      return !strActual.includes(strRule);

    case 'greater_than':
    case 'gt':
    case '>':
      return Number(actualVal) > Number(ruleVal);

    case 'greater_than_or_equal':
    case 'gte':
    case '>=':
      return Number(actualVal) >= Number(ruleVal);

    case 'less_than':
    case 'lt':
    case '<':
      if (field === 'created_within_x_days') {
        return Number(actualVal) <= Number(ruleVal);
      }
      return Number(actualVal) < Number(ruleVal);

    case 'less_than_or_equal':
    case 'lte':
    case '<=':
      return Number(actualVal) <= Number(ruleVal);

    case 'in': {
      const allowed = Array.isArray(ruleVal)
        ? ruleVal.map((v) => String(v).toLowerCase().trim())
        : strRule.split(',').map((v) => v.trim());
      if (Array.isArray(actualVal)) {
        return actualVal.some((item) => allowed.includes(String(item).toLowerCase().trim()));
      }
      return allowed.includes(strActual);
    }

    case 'not_in': {
      const blocked = Array.isArray(ruleVal)
        ? ruleVal.map((v) => String(v).toLowerCase().trim())
        : strRule.split(',').map((v) => v.trim());
      if (Array.isArray(actualVal)) {
        return !actualVal.some((item) => blocked.includes(String(item).toLowerCase().trim()));
      }
      return !blocked.includes(strActual);
    }

    case 'is_empty':
    case 'empty':
      return !actualVal || strActual === '' || (Array.isArray(actualVal) && actualVal.length === 0);

    case 'is_set':
    case 'not_empty':
      return Boolean(actualVal) && strActual !== '' && (!Array.isArray(actualVal) || actualVal.length > 0);

    case 'between': {
      const num = Number(actualVal);
      const min = Array.isArray(ruleVal) ? Number(ruleVal[0]) : Number(rule.min || 0);
      const max = Array.isArray(ruleVal) ? Number(ruleVal[1]) : Number(rule.max || 100);
      return num >= min && num <= max;
    }

    default:
      return strActual === strRule;
  }
}

/**
 * Evaluates condition groups ({ all: [...], any: [...] })
 *
 * All conditions inside "all" must be true (AND).
 * At least one condition inside "any" must be true (OR).
 * Returns true if both group criteria are satisfied or if no conditions are configured.
 */
export function evaluateConditionsGroup(conditionsGroup = {}, lead, context = {}) {
  if (!conditionsGroup || typeof conditionsGroup !== 'object') {
    return true; // No conditions = always matches
  }

  const allRules = Array.isArray(conditionsGroup.all) ? conditionsGroup.all : [];
  const anyRules = Array.isArray(conditionsGroup.any) ? conditionsGroup.any : [];

  // If no rules in either group, default to match
  if (allRules.length === 0 && anyRules.length === 0) {
    return true;
  }

  // Check 'all' group (every rule must match)
  if (allRules.length > 0) {
    const allPassed = allRules.every((rule) => evaluateConditionRule(lead, rule, context));
    if (!allPassed) return false;
  }

  // Check 'any' group (at least one rule must match)
  if (anyRules.length > 0) {
    const anyPassed = anyRules.some((rule) => evaluateConditionRule(lead, rule, context));
    if (!anyPassed) return false;
  }

  return true;
}
