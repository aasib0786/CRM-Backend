import { connectDB as pool } from '../pool.js';

export const defaultAssignmentConfig = {
  method: 'round_robin',
  rules: [
    {
      id: "1",
      name: "IndiaMart Leads → Rajesh",
      active: true,
      condition: { field: "Source", operator: "is", value: "IndiaMart" },
      action: { type: "specific", agentId: "1", agentName: "Rajesh Kumar" },
      priority: 1,
    },
    {
      id: "2",
      name: "High Priority → Senior Agent",
      active: true,
      condition: { field: "Priority", operator: "is", value: "High" },
      action: { type: "specific", agentId: "2", agentName: "Priya Sharma" },
      priority: 2,
    },
    {
      id: "3",
      name: "JustDial → Amit",
      active: true,
      condition: { field: "Source", operator: "is", value: "JustDial" },
      action: { type: "specific", agentId: "3", agentName: "Amit Patel" },
      priority: 3,
    },
    {
      id: "4",
      name: "WhatsApp → Sneha",
      active: false,
      condition: { field: "Source", operator: "is", value: "WhatsApp" },
      action: { type: "specific", agentId: "4", agentName: "Sneha Rao" },
      priority: 4,
    },
    {
      id: "5",
      name: "IndiaMart Pune → Priya",
      active: true,
      condition: { field: "Source Account", operator: "is", value: "IndiaMart - Pune" },
      action: { type: "specific", agentId: "2", agentName: "Priya Sharma" },
      priority: 5,
    },
    {
      id: "6",
      name: "JustDial Mumbai → Amit",
      active: true,
      condition: { field: "Source Account", operator: "is", value: "JustDial - Mumbai" },
      action: { type: "specific", agentId: "3", agentName: "Amit Patel" },
      priority: 6,
    },
    {
      id: "7",
      name: "Unassigned fallback",
      active: true,
      condition: { field: "Any", operator: "no_match", value: "fallback" },
      action: { type: "round_robin" },
      priority: 7,
      isFallback: true,
    },
  ],
  escalationRules: [
    {
      id: "1",
      name: "Uncontacted Hot Leads > 2hr",
      condition: "Stage is New Inquiry AND Score > 70 AND Uncontacted > 2 hours",
      action: "Reassign to Manager (AASIB) + WhatsApp Alert",
      active: true,
    },
    {
      id: "2",
      name: "Stale Inquiries > 24hr",
      condition: "No activity logged > 24 hours from creation",
      action: "Auto-move to Round Robin queue for re-engagement",
      active: true,
    },
  ],
};

/**
 * Fetch assignment rules configuration from DB (seeds defaults if missing)
 */
export const getAssignmentConfigFromDb = async () => {
  try {
    const res = await pool.query(`SELECT * FROM public.assignment_rules_config WHERE id = 1`);
    if (res.rows[0]) {
      const row = res.rows[0];
      return {
        method: row.method || 'round_robin',
        rules: typeof row.rules === 'string' ? JSON.parse(row.rules) : row.rules || defaultAssignmentConfig.rules,
        escalationRules: typeof row.escalation_rules === 'string' ? JSON.parse(row.escalation_rules) : row.escalation_rules || defaultAssignmentConfig.escalationRules,
      };
    }

    // Seed defaults into database if empty
    await pool.query(
      `INSERT INTO public.assignment_rules_config (id, method, rules, escalation_rules, updated_at)
       VALUES (1, $1, $2, $3, NOW())
       ON CONFLICT (id) DO NOTHING`,
      [
        defaultAssignmentConfig.method,
        JSON.stringify(defaultAssignmentConfig.rules),
        JSON.stringify(defaultAssignmentConfig.escalationRules),
      ]
    ).catch(() => {});

    return defaultAssignmentConfig;
  } catch (err) {
    console.error('getAssignmentConfigFromDb error:', err.message);
    return defaultAssignmentConfig;
  }
};

/**
 * Helper to parse numeric deal value from string or number
 */
function parseDealValue(val) {
  if (typeof val === 'number') return val;
  if (!val) return 0;
  const str = String(val).toLowerCase().replace(/,/g, '').trim();
  if (str.includes('cr')) {
    const num = parseFloat(str.replace(/[^0-9.]/g, '')) || 0;
    return num * 10000000;
  }
  if (str.includes('l') || str.includes('lac') || str.includes('lakh')) {
    const num = parseFloat(str.replace(/[^0-9.]/g, '')) || 0;
    return num * 100000;
  }
  if (str.includes('k')) {
    const num = parseFloat(str.replace(/[^0-9.]/g, '')) || 0;
    return num * 1000;
  }
  return parseFloat(str.replace(/[^0-9.]/g, '')) || 0;
}

/**
 * Evaluate if lead matches rule condition
 */
function evaluateRuleCondition(lead, condition) {
  if (!condition) return false;
  const field = (condition.field || '').toLowerCase().trim();
  const operator = (condition.operator || 'is').toLowerCase().trim();
  const val = (condition.value || '').toLowerCase().trim();

  let targetVal = '';
  if (field === 'source') {
    targetVal = (lead.source || '').toLowerCase().trim();
  } else if (field === 'priority') {
    targetVal = (lead.priority || '').toLowerCase().trim();
  } else if (field === 'industry') {
    targetVal = (lead.industry || '').toLowerCase().trim();
  } else if (field.includes('deal') || field.includes('value')) {
    const leadVal = parseDealValue(lead.value);
    const condVal = parseDealValue(condition.value);
    if (operator === 'greater_than' || operator === '>') return leadVal > condVal;
    if (operator === 'less_than' || operator === '<') return leadVal < condVal;
    return leadVal === condVal;
  } else if (field.includes('source account') || field.includes('account')) {
    targetVal = (lead.source_account || lead.sourceAccount || lead.source || '').toLowerCase().trim();
  } else {
    const extra = { ...(lead.custom_fields || {}), ...(lead.extra_fields || {}) };
    targetVal = String(extra[condition.field] || lead[condition.field] || '').toLowerCase().trim();
  }

  if (operator === 'is' || operator === 'equals') {
    return targetVal === val || targetVal.includes(val);
  }
  if (operator === 'contains') {
    return targetVal.includes(val);
  }
  if (operator === 'is_not') {
    return targetVal !== val && !targetVal.includes(val);
  }
  if (operator === 'no_match') {
    return false;
  }

  return targetVal === val;
}

/**
 * Find agent with lowest active workload
 */
async function getLowestLoadAgent(activeAgents) {
  if (!activeAgents || activeAgents.length === 0) return null;
  try {
    const { rows } = await pool.query(`
      SELECT assigned, COUNT(*)::int as count 
      FROM public.leads 
      WHERE assigned IS NOT NULL AND assigned <> '' 
        AND stage NOT IN ('Closed Won', 'Lost')
      GROUP BY assigned
    `);
    const countMap = {};
    activeAgents.forEach((a) => { countMap[a] = 0; });
    rows.forEach((r) => {
      if (countMap[r.assigned] !== undefined) {
        countMap[r.assigned] = Number(r.count) || 0;
      }
    });

    let minAgent = activeAgents[0];
    let minCount = countMap[minAgent] || 0;
    for (const a of activeAgents) {
      if ((countMap[a] || 0) < minCount) {
        minAgent = a;
        minCount = countMap[a];
      }
    }
    return minAgent;
  } catch {
    return activeAgents[0];
  }
}

/**
 * Find next agent in round-robin rotation
 */
let roundRobinIndex = 0;
async function getNextRoundRobinAgent(activeAgents) {
  if (!activeAgents || activeAgents.length === 0) return null;
  try {
    const { rows } = await pool.query(`
      SELECT assigned FROM public.leads 
      WHERE assigned IS NOT NULL AND assigned <> '' 
      ORDER BY created_at DESC LIMIT 1
    `);
    const lastAssigned = rows[0]?.assigned;
    if (lastAssigned) {
      const idx = activeAgents.indexOf(lastAssigned);
      if (idx !== -1) {
        roundRobinIndex = (idx + 1) % activeAgents.length;
        return activeAgents[roundRobinIndex];
      }
    }
  } catch {}
  const chosen = activeAgents[roundRobinIndex % activeAgents.length];
  roundRobinIndex = (roundRobinIndex + 1) % activeAgents.length;
  return chosen;
}

/**
 * Automatically determine assigned agent for a lead based on active rules & method
 */
export const determineLeadAssignee = async (leadData) => {
  try {
    const config = await getAssignmentConfigFromDb();
    const method = config.method || 'round_robin';
    const rules = Array.isArray(config.rules) ? config.rules : [];

    // Filter active rules, sort by priority ascending (Priority 1 first)
    const activeRules = rules
      .filter((r) => r.active && !r.isFallback)
      .sort((a, b) => (Number(a.priority) || 99) - (Number(b.priority) || 99));

    // Get active team members
    const agentsResult = await pool.query(
      `SELECT id, name, role FROM public.users WHERE is_active IS NOT FALSE ORDER BY id ASC`
    ).catch(() => ({ rows: [] }));
    let activeAgents = agentsResult.rows.map((u) => u.name).filter(Boolean);

    // Fallback default agents if users table is empty
    if (activeAgents.length === 0) {
      activeAgents = ['Rajesh Kumar', 'Priya Sharma', 'Amit Patel', 'Sneha Rao'];
    }

    // 1. Evaluate priority rules
    for (const rule of activeRules) {
      if (evaluateRuleCondition(leadData, rule.condition)) {
        if (rule.action?.type === 'specific' && rule.action.agentName) {
          return {
            assigned: rule.action.agentName,
            matchedRule: rule.name,
            reason: `Assigned via rule: ${rule.name}`,
          };
        } else if (rule.action?.type === 'round_robin') {
          const nextAgent = await getNextRoundRobinAgent(activeAgents);
          if (nextAgent) {
            return {
              assigned: nextAgent,
              matchedRule: rule.name,
              reason: `Assigned via rule (${rule.name}) using Round Robin`,
            };
          }
        }
      }
    }

    // 2. Fallback to default strategy method
    if (method === 'manual' || method === 'manual_only') {
      return { assigned: null, reason: 'Manual assignment method active' };
    }

    if (method === 'load_based') {
      const loadAgent = await getLowestLoadAgent(activeAgents);
      if (loadAgent) {
        return { assigned: loadAgent, reason: 'Assigned via Load Based distribution' };
      }
    }

    if (method === 'source_based') {
      const src = (leadData.source || '').toLowerCase();
      if (src.includes('indiamart')) return { assigned: 'Rajesh Kumar', reason: 'Source Based: IndiaMart' };
      if (src.includes('justdial')) return { assigned: 'Amit Patel', reason: 'Source Based: JustDial' };
      if (src.includes('website')) return { assigned: 'Priya Sharma', reason: 'Source Based: Website' };
      if (src.includes('whatsapp')) return { assigned: 'Sneha Rao', reason: 'Source Based: WhatsApp' };
    }

    // Default: Round Robin
    const rrAgent = await getNextRoundRobinAgent(activeAgents);
    if (rrAgent) {
      return { assigned: rrAgent, reason: 'Assigned via Default Round Robin' };
    }

    return { assigned: null, reason: 'No agent available' };
  } catch (err) {
    console.error('determineLeadAssignee error:', err.message);
    return { assigned: null, error: err.message };
  }
};
