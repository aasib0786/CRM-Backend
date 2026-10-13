import { connectDB as pool } from '../pool.js';

export const defaultScoringConfig = {
  method: 'automatic',
  factors: [
    {
      id: 'source',
      factor: 'Source Quality',
      criteria: 'IndiaMart=20, JustDial=18, Website=15, WhatsApp=12',
      maxPoints: 20,
      active: true,
    },
    {
      id: 'response_time',
      factor: 'Response Time',
      criteria: '<1hr=20, 1-4hr=15, 4-24hr=10, >24hr=5',
      maxPoints: 20,
      active: true,
    },
    {
      id: 'stage',
      factor: 'Pipeline Stage',
      criteria: 'New=5, Site Visit=8, Done=12, Proposal=15, Negotiation=18, Booking=20',
      maxPoints: 20,
      active: true,
    },
    {
      id: 'engagement',
      factor: 'Engagement Level',
      criteria: 'WA reply=+5, Email open=+3, Callback=+5, No engage=-5',
      maxPoints: 20,
      active: true,
    },
    {
      id: 'value',
      factor: 'Deal Value',
      criteria: '>1Cr=20, 50L-1Cr=16, 25L-50L=12, 10L-25L=8, <10L=5',
      maxPoints: 20,
      active: true,
    },
    {
      id: 'profile',
      factor: 'Profile Completeness',
      criteria: 'All fields filled=+5 bonus',
      maxPoints: 5,
      active: true,
    },
  ],
  thresholds: [
    {
      id: 'hot',
      label: 'Hot Lead',
      color: 'green',
      icon: 'ri-fire-fill',
      description: 'Hot leads get priority assignment',
      from: 71,
      to: 100,
    },
    {
      id: 'warm',
      label: 'Warm Lead',
      color: 'amber',
      icon: 'ri-star-fill',
      description: 'Warm leads assigned by round robin',
      from: 41,
      to: 70,
    },
    {
      id: 'cold',
      label: 'Cold Lead',
      color: 'red',
      icon: 'ri-snowy-fill',
      description: 'Cold leads go to unassigned queue',
      from: 0,
      to: 40,
    },
  ],
  actions: [
    {
      id: 1,
      trigger: 'When lead becomes Hot (>70)',
      description: [
        'Auto-assign to primary sales agent',
        'Send WhatsApp welcome message',
      ],
      enabled: true,
    },
    {
      id: 2,
      trigger: 'When lead drops to Cold (<40)',
      description: [
        'Add to re-engagement sequence',
        'Notify assigned agent',
      ],
      enabled: true,
    },
    {
      id: 3,
      trigger: 'When score unchanged for 7 days',
      description: [
        'Flag for manual review',
        'Send activity reminder to agent',
      ],
      enabled: false,
    },
  ],
};

/**
 * Fetch scoring configuration from DB (seeds default if missing)
 */
export const getScoringConfigFromDb = async () => {
  try {
    const res = await pool.query(`SELECT * FROM public.lead_scoring_config WHERE id = 1`);
    if (res.rows[0]) {
      const row = res.rows[0];
      return {
        method: row.method || 'automatic',
        factors: typeof row.factors === 'string' ? JSON.parse(row.factors) : row.factors || defaultScoringConfig.factors,
        thresholds: typeof row.thresholds === 'string' ? JSON.parse(row.thresholds) : row.thresholds || defaultScoringConfig.thresholds,
        actions: typeof row.actions === 'string' ? JSON.parse(row.actions) : row.actions || defaultScoringConfig.actions,
      };
    }

    // Seed default if empty
    await pool.query(
      `INSERT INTO public.lead_scoring_config (id, method, factors, thresholds, actions, updated_at)
       VALUES (1, $1, $2, $3, $4, NOW())
       ON CONFLICT (id) DO NOTHING`,
      [
        defaultScoringConfig.method,
        JSON.stringify(defaultScoringConfig.factors),
        JSON.stringify(defaultScoringConfig.thresholds),
        JSON.stringify(defaultScoringConfig.actions),
      ]
    ).catch(() => {});

    return defaultScoringConfig;
  } catch (err) {
    console.error('getScoringConfigFromDb error:', err.message);
    return defaultScoringConfig;
  }
};

/**
 * Parse numeric deal value from string or number
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
  const clean = parseFloat(str.replace(/[^0-9.]/g, '')) || 0;
  return clean;
}

/**
 * Helper to parse comma / semicolon / newline separated criteria strings like:
 * "New=5, Site Visit=8, Done=12, Proposal=15, Negotiation=18, Booking=20"
 * "<1hr=20, 1-4hr=15, 4-24hr=10, >24hr=5"
 * "IndiaMart=20, JustDial=18, Website=15, WhatsApp=12"
 */
export function parseCriteriaMap(criteriaStr) {
  if (!criteriaStr || typeof criteriaStr !== 'string') return {};
  const map = {};
  const parts = criteriaStr.split(/[,;\n]+/);
  for (const part of parts) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const eqIdx = trimmed.indexOf('=');
    const colonIdx = trimmed.indexOf(':');
    const splitIdx = eqIdx !== -1 ? eqIdx : colonIdx;
    if (splitIdx !== -1) {
      const key = trimmed.slice(0, splitIdx).trim().toLowerCase();
      const valStr = trimmed.slice(splitIdx + 1).replace(/[^0-9.-]/g, '').trim();
      const val = parseFloat(valStr);
      if (!isNaN(val)) {
        map[key] = val;
      }
    }
  }
  return map;
}

/**
 * Identify factor category regardless of exact ID or custom naming
 */
export function getFactorCategory(f) {
  const id = (f.id || '').toLowerCase();
  const name = (f.factor || '').toLowerCase();

  if (id.includes('stage') || name.includes('stage') || name.includes('pipeline')) return 'stage';
  if (id.includes('source') || name.includes('source') || name.includes('channel')) return 'source';
  if (id.includes('response') || name.includes('response') || id.includes('time') || name.includes('time') || name.includes('sla')) return 'response_time';
  if (id.includes('engage') || name.includes('engage') || id.includes('activity') || name.includes('recency')) return 'engagement';
  if (id.includes('deal') || name.includes('deal') || id.includes('value') || name.includes('value') || name.includes('budget') || name.includes('amount')) return 'value';
  if (id.includes('profile') || name.includes('profile') || name.includes('completeness') || name.includes('contact')) return 'profile';
  if (id.includes('priority') || name.includes('priority')) return 'priority';

  return id || 'default';
}

/**
 * Calculate dynamic lead score & factor breakdown for a lead
 */
export const calculateLeadScore = (lead, config = defaultScoringConfig) => {
  if (!lead) return { score: 50, scoreFactors: [] };
  if (config.method === 'manual' && lead.score !== undefined && lead.score !== null) {
    return {
      score: Math.min(100, Math.max(0, Math.round(Number(lead.score)))),
      scoreFactors: Array.isArray(lead.score_factors || lead.scoreFactors) ? (lead.score_factors || lead.scoreFactors) : [],
    };
  }

  const factors = Array.isArray(config.factors) && config.factors.length > 0 ? config.factors : defaultScoringConfig.factors;
  let totalScore = 0;
  let maxPossible = 0;
  const breakdown = [];

  factors.forEach((f) => {
    if (!f.active) return;
    const maxPts = Number(f.maxPoints) || 20;
    maxPossible += maxPts;
    let earned = 0;
    const category = getFactorCategory(f);
    const criteriaMap = parseCriteriaMap(f.criteria);

    switch (category) {
      // ─── 1. PIPELINE STAGE ──────────────────────────────────────
      case 'stage': {
        const rawStage = (lead.stage || '').toLowerCase().trim();

        // 1a. Try direct key match against criteria map (e.g. Booking=20, New=5, etc.)
        let matchedPts = null;
        for (const [key, pts] of Object.entries(criteriaMap)) {
          const k = key.toLowerCase().trim();
          if (rawStage === k || (k.length > 2 && rawStage.includes(k)) || (rawStage.length > 2 && k.includes(rawStage))) {
            matchedPts = pts;
            break;
          }
        }

        // 1b. Semantic matching with criteria priority
        if (matchedPts === null) {
          if (rawStage.includes('booking') || rawStage.includes('closed won') || rawStage.includes('won') || rawStage.includes('documentation')) {
            matchedPts = criteriaMap['booking'] ?? criteriaMap['booking done'] ?? criteriaMap['won'] ?? maxPts;
          } else if (rawStage.includes('negotiation')) {
            matchedPts = criteriaMap['negotiation'] ?? Math.round(maxPts * 0.9);
          } else if (rawStage.includes('proposal')) {
            matchedPts = criteriaMap['proposal'] ?? criteriaMap['proposal sent'] ?? Math.round(maxPts * 0.75);
          } else if (rawStage.includes('done') || rawStage.includes('visit done')) {
            matchedPts = criteriaMap['done'] ?? criteriaMap['site visit done'] ?? Math.round(maxPts * 0.6);
          } else if (rawStage.includes('visit') || rawStage.includes('scheduled')) {
            matchedPts = criteriaMap['site visit'] ?? criteriaMap['site visit scheduled'] ?? Math.round(maxPts * 0.4);
          } else if (rawStage.includes('new') || rawStage.includes('inquiry') || rawStage.includes('lead')) {
            matchedPts = criteriaMap['new'] ?? criteriaMap['new inquiry'] ?? criteriaMap['new lead'] ?? Math.round(maxPts * 0.25);
          } else if (rawStage.includes('lost')) {
            matchedPts = 0;
          } else {
            matchedPts = Math.round(maxPts * 0.25);
          }
        }

        earned = matchedPts !== null ? matchedPts : Math.round(maxPts * 0.25);
        break;
      }

      // ─── 2. SOURCE QUALITY ──────────────────────────────────────
      case 'source': {
        const rawSource = (lead.source || '').toLowerCase().trim();

        // Direct criteria map matching
        let matchedPts = null;
        for (const [key, pts] of Object.entries(criteriaMap)) {
          const k = key.toLowerCase().trim();
          if (rawSource === k || (k.length > 2 && rawSource.includes(k)) || (rawSource.length > 2 && k.includes(rawSource))) {
            matchedPts = pts;
            break;
          }
        }

        if (matchedPts === null) {
          if (rawSource.includes('indiamart')) matchedPts = criteriaMap['indiamart'] ?? maxPts;
          else if (rawSource.includes('justdial')) matchedPts = criteriaMap['justdial'] ?? Math.round(maxPts * 0.9);
          else if (rawSource.includes('tradeindia')) matchedPts = criteriaMap['tradeindia'] ?? Math.round(maxPts * 0.8);
          else if (rawSource.includes('website')) matchedPts = criteriaMap['website'] ?? Math.round(maxPts * 0.75);
          else if (rawSource.includes('social') || rawSource.includes('facebook') || rawSource.includes('instagram')) matchedPts = criteriaMap['social media'] ?? Math.round(maxPts * 0.7);
          else if (rawSource.includes('whatsapp')) matchedPts = criteriaMap['whatsapp'] ?? Math.round(maxPts * 0.6);
          else if (rawSource.includes('manual')) matchedPts = criteriaMap['manual'] ?? Math.round(maxPts * 0.5);
          else matchedPts = Math.round(maxPts * 0.5);
        }

        earned = matchedPts !== null ? matchedPts : Math.round(maxPts * 0.5);
        break;
      }

      // ─── 3. RESPONSE TIME ───────────────────────────────────────
      case 'response_time': {
        const created = lead.created_at || lead.createdAt;
        const lastAct = lead.last_activity || lead.lastActivity;
        let hours = 2; // sensible middle default if unmeasurable
        if (created) {
          const createdMs = new Date(created).getTime();
          if (!isNaN(createdMs)) {
            const actMs = lastAct ? new Date(lastAct).getTime() : Date.now();
            hours = Math.max(0, (actMs - createdMs) / (1000 * 60 * 60));
          }
        }

        let ptsUnder1 = 20;
        let pts1to4 = 15;
        let pts4to24 = 10;
        let ptsOver24 = 5;

        for (const [k, v] of Object.entries(criteriaMap)) {
          if (k.includes('<1') || k.includes('< 1')) ptsUnder1 = v;
          else if (k.includes('1-4') || k.includes('1 to 4')) pts1to4 = v;
          else if (k.includes('4-24') || k.includes('4 to 24')) pts4to24 = v;
          else if (k.includes('>24') || k.includes('> 24') || k.includes('over 24')) ptsOver24 = v;
        }

        if (hours <= 1) earned = ptsUnder1;
        else if (hours <= 4) earned = pts1to4;
        else if (hours <= 24) earned = pts4to24;
        else earned = ptsOver24;
        break;
      }

      // ─── 4. ENGAGEMENT LEVEL ────────────────────────────────────
      case 'engagement': {
        const waBonus = criteriaMap['wa reply'] ?? criteriaMap['whatsapp'] ?? 5;
        const emailBonus = criteriaMap['email open'] ?? criteriaMap['email'] ?? 3;
        const callBonus = criteriaMap['callback'] ?? criteriaMap['call'] ?? 5;

        let pts = 0;
        const activities = Array.isArray(lead.activities) ? lead.activities : [];

        if (activities.length > 0) {
          activities.forEach((act) => {
            const actType = ((act.type || '') + ' ' + (act.description || '')).toLowerCase();
            if (actType.includes('whatsapp') || actType.includes('wa')) pts += waBonus;
            else if (actType.includes('call')) pts += callBonus;
            else if (actType.includes('email')) pts += emailBonus;
            else pts += 3;
          });
          earned = Math.min(maxPts, Math.max(0, pts));
        } else {
          // If activities are not loaded in object, check last_activity recency
          const hasInteraction = lead.last_activity && lead.created_at &&
            new Date(lead.last_activity).getTime() !== new Date(lead.created_at).getTime();
          earned = hasInteraction ? Math.round(maxPts * 0.6) : Math.round(maxPts * 0.25);
        }
        break;
      }

      // ─── 5. DEAL VALUE ──────────────────────────────────────────
      case 'value': {
        const valNum = parseDealValue(lead.value);

        let pts1Cr = 20;
        let pts50L = 16;
        let pts25L = 12;
        let pts10L = 8;
        let ptsUnder10L = 5;

        for (const [k, v] of Object.entries(criteriaMap)) {
          if (k.includes('>1cr') || (k.includes('1cr') && !k.includes('50l-1cr'))) pts1Cr = v;
          else if (k.includes('50l')) pts50L = v;
          else if (k.includes('25l')) pts25L = v;
          else if (k.includes('10l-25l') || (k.includes('10l') && !k.includes('<10l'))) pts10L = v;
          else if (k.includes('<10l') || k.includes('under 10l')) ptsUnder10L = v;
        }

        if (valNum >= 10000000) earned = pts1Cr;
        else if (valNum >= 5000000) earned = pts50L;
        else if (valNum >= 2500000) earned = pts25L;
        else if (valNum >= 1000000) earned = pts10L;
        else if (valNum > 0) earned = ptsUnder10L;
        else earned = Math.round(maxPts * 0.2); // Base deal value (e.g. ₹0)
        break;
      }

      // ─── 6. PROFILE COMPLETENESS ────────────────────────────────
      case 'profile': {
        let filled = 0;
        const total = 5;

        if (lead.phone && String(lead.phone).trim()) filled++;
        if (lead.email && String(lead.email).trim()) filled++;
        if (lead.company && String(lead.company).trim() && lead.company.trim() !== '—' && lead.company.trim() !== '-') filled++;
        if (lead.industry || lead.project_id || lead.projectId || lead.projectName) filled++;

        const custom = lead.custom_fields || lead.customFields;
        const extra = lead.extra_fields || lead.extraFields;
        const hasExtra = (custom && typeof custom === 'object' && Object.keys(custom).length > 0) ||
                         (extra && typeof extra === 'object' && Object.keys(extra).length > 0);
        if (hasExtra) filled++;

        if (maxPts <= 5) {
          earned = filled >= 4 ? maxPts : Math.max(1, filled);
        } else {
          earned = Math.round((filled / total) * maxPts);
        }
        break;
      }

      // ─── 7. LEAD PRIORITY ───────────────────────────────────────
      case 'priority': {
        const pr = (lead.priority || '').toLowerCase();
        if (pr === 'high') earned = criteriaMap['high'] ?? maxPts;
        else if (pr === 'medium') earned = criteriaMap['medium'] ?? Math.round(maxPts * 0.7);
        else earned = criteriaMap['low'] ?? Math.round(maxPts * 0.4);
        break;
      }

      default: {
        earned = Math.round(maxPts * 0.5);
        break;
      }
    }

    earned = Math.min(maxPts, Math.max(0, earned));
    totalScore += earned;
    breakdown.push({
      label: f.factor || f.id,
      score: earned,
      max: maxPts,
    });
  });

  // Normalize final score to 0 - 100 range
  let normalizedFinal = totalScore;
  if (maxPossible > 0 && maxPossible !== 100) {
    normalizedFinal = Math.round((totalScore / maxPossible) * 100);
  }
  normalizedFinal = Math.min(100, Math.max(0, normalizedFinal));

  return {
    score: normalizedFinal,
    scoreFactors: breakdown,
  };
};

/**
 * Recalculate scores for all leads in the database based on active scoring rules
 */
export const recalculateAllLeadScores = async () => {
  try {
    const config = await getScoringConfigFromDb();
    if (config.method === 'manual') {
      return { success: true, count: 0, message: 'Scoring method is manual' };
    }

    const { rows } = await pool.query(`SELECT * FROM public.leads`);
    let updatedCount = 0;

    for (const lead of rows) {
      const { score, scoreFactors } = calculateLeadScore(lead, config);
      await pool.query(
        `UPDATE public.leads SET score = $1, score_factors = $2 WHERE id = $3`,
        [score, JSON.stringify(scoreFactors), lead.id]
      );
      updatedCount++;
    }

    return { success: true, count: updatedCount, message: `Successfully recalculated ${updatedCount} leads` };
  } catch (err) {
    console.error('recalculateAllLeadScores error:', err.message);
    return { success: false, error: err.message };
  }
};
