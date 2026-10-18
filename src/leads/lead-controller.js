// src/leads/leads-controller.js
import { connectDB } from '../pool.js';
import { logActivity } from '../activities/activityLogger.js';
import { getScoringConfigFromDb, calculateLeadScore } from './scoringService.js';
import { determineLeadAssignee } from './assignmentService.js';

// Auto-migrate notifications table to include activity_id if missing
connectDB.query('ALTER TABLE public.notifications ADD COLUMN IF NOT EXISTS activity_id VARCHAR(100)').catch(() => {});

// ─── Helpers ─────────────────────────────────────────────────

const toLeadDTO = (row) => {
    let customFields = {};
    if (typeof row.custom_fields === 'object' && row.custom_fields !== null) {
        customFields = row.custom_fields;
    } else if (typeof row.custom_fields === 'string') {
        try { customFields = JSON.parse(row.custom_fields); } catch (e) { customFields = {}; }
    }

    let extraFields = {};
    if (typeof row.extra_fields === 'object' && row.extra_fields !== null) {
        extraFields = row.extra_fields;
    } else if (typeof row.extra_fields === 'string') {
        try { extraFields = JSON.parse(row.extra_fields); } catch (e) { extraFields = {}; }
    }

    let scoreFactors = [];
    if (Array.isArray(row.score_factors)) {
        scoreFactors = row.score_factors;
    } else if (typeof row.score_factors === 'string') {
        try { scoreFactors = JSON.parse(row.score_factors); } catch (e) { scoreFactors = []; }
    }

    let tags = [];
    if (Array.isArray(row.tags)) {
        tags = row.tags;
    } else if (typeof row.tags === 'string') {
        try { tags = JSON.parse(row.tags); } catch (e) { tags = []; }
    }

    return {
        id: row.id,
        name: row.name,
        company: row.company || '',
        phone: row.phone || '',
        email: row.email || '',
        source: row.source || 'Manual',
        stage: row.stage || 'New Inquiry',
        priority: row.priority || 'Medium',
        assigned: row.assigned || null,
        industry: row.industry || null,
        value: row.value || '₹0',
        score: row.score ?? 50,
        scoreFactors,
        tags,
        notes: row.notes || null,
        projectId: row.project_id || null,
        project_id: row.project_id || null,
        projectName: row.project_name || null,
        projectColor: row.project_color || null,
        customFields,
        custom_fields: customFields,
        extraFields,
        lastActivity: row.last_activity,
        nextActivityAt: row.next_activity_at || null,
        scheduledActivityType: row.scheduled_activity_type || null,
        scheduledActivityNote: row.scheduled_activity_note || null,
        botStatus: row.bot_status || null,
        botTurns: Number(row.bot_turns || 0),
        botCollectedData: typeof row.bot_collected_data === 'object' && row.bot_collected_data !== null ? row.bot_collected_data : (typeof row.bot_collected_data === 'string' ? JSON.parse(row.bot_collected_data || '{}') : {}),
        createdAt: row.created_at,
        updatedAt: row.updated_at,
    };
};

const getScoreCategory = (score) => {
    if (score >= 80) return 'hot';
    if (score >= 50) return 'warm';
    return 'cold';
};

// ─── Team Hierarchy RBAC Helper ─────────────────────────────
export const getHierarchyAllowedAssignees = async (user) => {
    if (!user || (!user.id && !user.email)) {
        return null;
    }

    try {
        let currentU = null;
        if (user.id) {
            const { rows } = await connectDB.query(
                `SELECT id, name, email, role, manager_id FROM public.users WHERE id::text = $1`,
                [String(user.id)]
            ).catch(() => ({ rows: [] }));
            if (rows.length > 0) currentU = rows[0];
        }

        if (!currentU && user.email) {
            const { rows } = await connectDB.query(
                `SELECT id, name, email, role, manager_id FROM public.users WHERE LOWER(email) = LOWER($1)`,
                [user.email.trim()]
            ).catch(() => ({ rows: [] }));
            if (rows.length > 0) currentU = rows[0];
        }

        if (!currentU) return null;

        const role = (currentU.role || '').toLowerCase().trim();

        // Super Admin & Admin have unrestricted access across all branches/teams
        if (role === 'super_admin' || role === 'admin') {
            return null;
        }

        // Recursive CTE to resolve current user + all subordinates (direct & indirect reportees)
        const { rows: subRows } = await connectDB.query(`
            WITH RECURSIVE subordinates AS (
                SELECT id, name, email, manager_id
                FROM public.users
                WHERE id = $1

                UNION ALL

                SELECT u.id, u.name, u.email, u.manager_id
                FROM public.users u
                INNER JOIN subordinates s ON u.manager_id = s.id
            )
            SELECT id, name, email FROM subordinates
        `, [currentU.id]).catch(() => ({ rows: [] }));

        const allowedAssignees = new Set();
        subRows.forEach((r) => {
            if (r.name && r.name.trim()) allowedAssignees.add(r.name.trim());
            if (r.email && r.email.trim()) allowedAssignees.add(r.email.trim());
            if (r.id) allowedAssignees.add(String(r.id));
        });

        if (currentU.name && currentU.name.trim()) {
            allowedAssignees.add(currentU.name.trim());
        }

        const isManager = subRows.length > 1;

        return {
            allowedList: Array.from(allowedAssignees),
            isManager,
            currentUserName: currentU.name,
            currentUserId: currentU.id,
        };
    } catch (err) {
        console.error('getHierarchyAllowedAssignees error:', err.message);
        return null;
    }
};

let isLeadsUuidMigrated = false;
export const ensureLeadsUuid = async () => {
    if (isLeadsUuidMigrated) return;
    try {
        const check = await connectDB.query(`
            SELECT data_type FROM information_schema.columns 
            WHERE table_name = 'leads' AND column_name = 'id'
        `);
        if (check.rows[0] && check.rows[0].data_type !== 'uuid') {
            console.log("⚡ Migrating leads.id from integer to UUID...");
            await connectDB.query(`CREATE EXTENSION IF NOT EXISTS "pgcrypto"`);
            await connectDB.query(`CREATE EXTENSION IF NOT EXISTS "uuid-ossp"`);

            await connectDB.query(`ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS new_id UUID DEFAULT gen_random_uuid()`);
            await connectDB.query(`UPDATE public.leads SET new_id = gen_random_uuid() WHERE new_id IS NULL`);

            await connectDB.query(`
                DO $$
                BEGIN
                    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'lead_activities') THEN
                        ALTER TABLE public.lead_activities ADD COLUMN IF NOT EXISTS new_lead_id UUID;
                        UPDATE public.lead_activities la 
                        SET new_lead_id = l.new_id 
                        FROM public.leads l 
                        WHERE la.lead_id::text = l.id::text;
                        
                        ALTER TABLE public.lead_activities DROP CONSTRAINT IF EXISTS lead_activities_lead_id_fkey;
                        ALTER TABLE public.lead_activities DROP COLUMN IF EXISTS lead_id;
                        ALTER TABLE public.lead_activities RENAME COLUMN new_lead_id TO lead_id;
                    END IF;

                    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'notifications') THEN
                        ALTER TABLE public.notifications ADD COLUMN IF NOT EXISTS new_lead_id UUID;
                        UPDATE public.notifications n 
                        SET new_lead_id = l.new_id 
                        FROM public.leads l 
                        WHERE n.lead_id::text = l.id::text;

                        ALTER TABLE public.notifications DROP COLUMN IF EXISTS lead_id;
                        ALTER TABLE public.notifications RENAME COLUMN new_lead_id TO lead_id;
                    END IF;

                    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'whatsapp_chats') THEN
                        UPDATE public.whatsapp_chats c 
                        SET lead_id = l.new_id::text 
                        FROM public.leads l 
                        WHERE c.lead_id = l.id::text;
                    END IF;

                    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'quotations') THEN
                        UPDATE public.quotations q 
                        SET lead_id = l.new_id::text 
                        FROM public.leads l 
                        WHERE q.lead_id = l.id::text;
                    END IF;

                    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'activities') THEN
                        UPDATE public.activities a 
                        SET lead_id = l.new_id::text 
                        FROM public.leads l 
                        WHERE a.lead_id = l.id::text;
                    END IF;

                    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'projects') THEN
                        UPDATE public.projects p 
                        SET lead_id = l.new_id 
                        FROM public.leads l 
                        WHERE p.lead_id::text = l.id::text;
                    END IF;

                    ALTER TABLE public.leads DROP CONSTRAINT IF EXISTS leads_pkey CASCADE;
                    ALTER TABLE public.leads DROP COLUMN IF EXISTS id;
                    ALTER TABLE public.leads RENAME COLUMN new_id TO id;
                    ALTER TABLE public.leads ADD PRIMARY KEY (id);
                    ALTER TABLE public.leads ALTER COLUMN id SET DEFAULT gen_random_uuid();

                    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'lead_activities') THEN
                        ALTER TABLE public.lead_activities ADD CONSTRAINT lead_activities_lead_id_fkey FOREIGN KEY (lead_id) REFERENCES public.leads(id) ON DELETE CASCADE;
                    END IF;
                END $$;
            `);
            console.log("✅ leads.id successfully migrated to UUID!");
        }
        isLeadsUuidMigrated = true;
    } catch (err) {
        console.error("ensureLeadsUuid error:", err.message);
    }
};

// ─── GET /leads ───────────────────────────────────────────────
export const getLeads = async (req, res) => {
    try {
        res.setHeader('X-Leads-Version', 'uuid-migration-v1');
        await ensureLeadsUuid();
        const page = Math.max(1, Number(req.query.page) || 1);
        const limit = Math.min(100, Number(req.query.limit) || 10);
        const search = (req.query.search || '').toString().trim();
        const source = (req.query.source || '').toString().trim();
        const stage = (req.query.stage || '').toString().trim();
        const assigned = (req.query.assigned || '').toString().trim();
        const industry = (req.query.industry || '').toString().trim();
        const priority = (req.query.priority || '').toString().trim();
        const scoreFilter = (req.query.score || '').toString().trim();
        const botFilter = (req.query.botFilter || req.query.bot_filter || '').toString().trim();
        const dateFilter = (req.query.date || '').toString().trim();
        const startDate = (req.query.startDate || req.query.start_date || req.query.from || '').toString().trim();
        const endDate = (req.query.endDate || req.query.end_date || req.query.to || '').toString().trim();
        const stale = req.query.stale === 'true';
        const sortBy = req.query.sortBy || 'last_activity';
        const sortDir = req.query.sortDir === 'asc' ? 'ASC' : 'DESC';
        const offset = (page - 1) * limit;

        const conditions = [];
        const values = [];
        let idx = 1;

        const companyId = req.user?.company_id || req.user?.companyId || req.company_id || req.headers?.['x-company-id'];
        if (companyId) {
            conditions.push(`l.company_id::text = $${idx}`);
            values.push(String(companyId));
            idx++;
        }

        // Team Hierarchy Access Control:
        // Rule: A lead is visible ONLY to the assigned agent and their superiors up the hierarchy chain.
        const hierarchy = await getHierarchyAllowedAssignees(req.user);
        if (hierarchy && hierarchy.allowedList && hierarchy.allowedList.length > 0) {
            if (hierarchy.isManager) {
                // Managers see leads assigned to themselves or anyone in their downline + unassigned leads
                conditions.push(`(
                    l.assigned = ANY($${idx}::text[]) OR 
                    l.assigned ILIKE ANY($${idx}::text[]) OR 
                    l.assigned IS NULL OR 
                    TRIM(l.assigned) = ''
                )`);
            } else {
                // Agents with no subordinates only see their own assigned leads
                conditions.push(`(
                    l.assigned = ANY($${idx}::text[]) OR 
                    l.assigned ILIKE ANY($${idx}::text[])
                )`);
            }
            values.push(hierarchy.allowedList);
            idx++;
        }

        if (search) {
            conditions.push(`(
        l.name    ILIKE $${idx} OR
        l.email   ILIKE $${idx} OR
        l.phone   ILIKE $${idx} OR
        l.company ILIKE $${idx}
      )`);
            values.push(`%${search}%`);
            idx++;
        }
        if (source && source !== 'all') { conditions.push(`l.source   = $${idx}`); values.push(source); idx++; }
        if (stage && stage !== 'all') { conditions.push(`l.stage    = $${idx}`); values.push(stage); idx++; }
        if (assigned && assigned !== 'all') { conditions.push(`l.assigned = $${idx}`); values.push(assigned); idx++; }
        if (industry && industry !== 'all') { conditions.push(`l.industry = $${idx}`); values.push(industry); idx++; }
        if (priority && priority !== 'all') { conditions.push(`l.priority = $${idx}`); values.push(priority); idx++; }

        // Score category filter with dynamic thresholds from config
        if (scoreFilter && scoreFilter !== 'all') {
            const scoringConfig = await getScoringConfigFromDb();
            const thresholds = scoringConfig?.thresholds || [];
            const hotT = thresholds.find((t) => t.id === 'hot') || { from: 71, to: 100 };
            const warmT = thresholds.find((t) => t.id === 'warm') || { from: 41, to: 70 };
            const coldT = thresholds.find((t) => t.id === 'cold') || { from: 0, to: 40 };

            if (scoreFilter === 'hot') {
                conditions.push(`l.score >= ${hotT.from}`);
            } else if (scoreFilter === 'warm') {
                conditions.push(`l.score >= ${warmT.from} AND l.score <= ${warmT.to}`);
            } else if (scoreFilter === 'cold') {
                conditions.push(`l.score <= ${coldT.to}`);
            }
        }

        // Date & Custom Date Range filter
        if (startDate) {
            conditions.push(`l.created_at >= $${idx}::date`);
            values.push(startDate);
            idx++;
        }
        if (endDate) {
            conditions.push(`l.created_at < ($${idx}::date + INTERVAL '1 day')`);
            values.push(endDate);
            idx++;
        }

        if (!startDate && !endDate && dateFilter && dateFilter !== 'all') {
            const dateMap = {
                today: `l.created_at >= CURRENT_DATE`,
                yesterday: `l.created_at >= CURRENT_DATE - INTERVAL '1 day' AND l.created_at < CURRENT_DATE`,
                week: `l.created_at >= date_trunc('week', NOW())`,
                this_week: `l.created_at >= date_trunc('week', NOW())`,
                month: `l.created_at >= date_trunc('month', NOW())`,
                this_month: `l.created_at >= date_trunc('month', NOW())`,
                last_30: `l.created_at >= NOW() - INTERVAL '30 days'`,
                last_90: `l.created_at >= NOW() - INTERVAL '90 days'`,
            };
            if (dateMap[dateFilter]) conditions.push(dateMap[dateFilter]);
        }

        // Project filter
        if (req.query.projectId || req.query.project_id) {
            const pid = req.query.projectId || req.query.project_id;
            if (pid && pid !== 'all') {
                conditions.push(`(l.project_id = $${idx} OR p.id::text = $${idx} OR p.name = $${idx})`);
                values.push(pid);
                idx++;
            }
        }

        // Bot filter (Phase 4: Handled by bot, Bot qualified, Waiting for agent)
        if (botFilter && botFilter !== 'all') {
            if (botFilter === 'handled_by_bot') {
                conditions.push(`EXISTS (SELECT 1 FROM public.bot_conversations bc_sub WHERE bc_sub.lead_id = l.id)`);
            } else if (botFilter === 'bot_qualified') {
                conditions.push(`EXISTS (SELECT 1 FROM public.bot_conversations bc_sub WHERE bc_sub.lead_id = l.id AND (bc_sub.status = 'handed_off' OR (bc_sub.collected_data->>'budget') IS NOT NULL OR (l.custom_fields->>'budget') IS NOT NULL))`);
            } else if (botFilter === 'waiting_for_agent') {
                conditions.push(`EXISTS (SELECT 1 FROM public.bot_conversations bc_sub WHERE bc_sub.lead_id = l.id AND bc_sub.status = 'handed_off' AND (l.assigned IS NULL OR l.assigned = 'Unassigned'))`);
            }
        }

        const whereClause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

        // Valid sort columns
        const validSort = {
            score: 'l.score',
            name: 'l.name',
            created_at: 'l.created_at',
            last_activity: 'COALESCE(l.last_activity, l.created_at)',
            priority: 'l.priority',
        };
        const orderCol = sortBy ? (validSort[sortBy] || 'COALESCE(l.last_activity, l.created_at)') : 'COALESCE(l.last_activity, l.created_at)';

        const [totalResult, result] = await Promise.all([
            connectDB.query(`
                SELECT COUNT(*)::int AS total 
                FROM leads l 
                LEFT JOIN projects p ON (l.project_id = p.id::text OR l.project_id = p.name)
                ${whereClause}
            `, values),
            connectDB.query(
                `SELECT l.*, 
                        p.name AS project_name, 
                        p.color AS project_color,
                        l.next_activity_at,
                        l.scheduled_activity_type,
                        l.scheduled_activity_note,
                        bc.status AS bot_status,
                        bc.turn_count AS bot_turns,
                        bc.collected_data AS bot_collected_data
                 FROM leads l
                 LEFT JOIN projects p ON (l.project_id = p.id::text OR l.project_id = p.name)
                 LEFT JOIN public.bot_conversations bc ON (bc.lead_id = l.id)
                 ${whereClause}
                 ORDER BY ${
                     sortBy
                         ? `${orderCol} ${sortDir}`
                         : `CASE WHEN l.next_activity_at IS NOT NULL THEN 0 ELSE 1 END ASC, l.next_activity_at DESC, COALESCE(l.last_activity, l.created_at) DESC`
                 }
                 LIMIT $${idx} OFFSET $${idx + 1}`,
                [...values, limit, offset]
            ),
        ]);

        const total = totalResult.rows[0]?.total || 0;
        const totalPages = Math.ceil(total / limit);

        const mappedItems = result.rows.map(toLeadDTO);
        return res.status(200).json({
            success: true,
            total,
            page,
            limit,
            totalPages,
            items: mappedItems,
            data: {
                items: mappedItems,
                total,
                page,
                limit,
                totalPages,
            },
        });
    } catch (error) {
        console.error('getLeads error:', error.message);
        return res.status(500).json({ success: false, message: 'Failed to fetch leads', error: process.env.NODE_ENV === 'development' ? error.message : undefined });
    }
};

// ─── GET /leads/stats ─────────────────────────────────────────
export const getLeadsStats = async (req, res) => {
    try {
        const scoringConfig = await getScoringConfigFromDb();
        const thresholds = scoringConfig?.thresholds || [];
        const hotT = thresholds.find((t) => t.id === 'hot') || { from: 71, to: 100 };
        const warmT = thresholds.find((t) => t.id === 'warm') || { from: 41, to: 70 };
        const coldT = thresholds.find((t) => t.id === 'cold') || { from: 0, to: 40 };

        const hierarchy = await getHierarchyAllowedAssignees(req.user);
        let hierarchyFilter = '';
        const statsParams = [];
        if (hierarchy && hierarchy.allowedList && hierarchy.allowedList.length > 0) {
            if (hierarchy.isManager) {
                hierarchyFilter = `WHERE (assigned = ANY($1::text[]) OR assigned ILIKE ANY($1::text[]) OR assigned IS NULL OR TRIM(assigned) = '')`;
            } else {
                hierarchyFilter = `WHERE (assigned = ANY($1::text[]) OR assigned ILIKE ANY($1::text[]))`;
            }
            statsParams.push(hierarchy.allowedList);
        }

        const [statsResult, agentCountsResult] = await Promise.all([
            connectDB.query(`
              SELECT
                COUNT(*)::int                                                                                            AS total,
                COUNT(*) FILTER (WHERE created_at >= CURRENT_DATE)::int                                                 AS new_today,
                COUNT(*) FILTER (WHERE stage IN ('Contacted', 'Site Visit Scheduled', 'Site Visit Done', 'Proposal Sent', 'Negotiation'))::int AS contacted,
                COUNT(*) FILTER (WHERE stage IN ('Booking Done', 'Closed Won'))::int                                     AS converted,
                COUNT(*) FILTER (WHERE assigned IS NULL OR TRIM(assigned) = '')::int                                    AS unassigned,
                COUNT(*) FILTER (WHERE last_activity <= NOW() - INTERVAL '7 days')::int                                 AS stale,
                COUNT(*) FILTER (WHERE score >= ${hotT.from})::int                                                       AS hot,
                COUNT(*) FILTER (WHERE score >= ${warmT.from} AND score <= ${warmT.to})::int                           AS warm,
                COUNT(*) FILTER (WHERE score <= ${coldT.to})::int                                                       AS cold,
                COALESCE(AVG(score)::int, 50)                                                                            AS avg_score
              FROM leads
              ${hierarchyFilter}
            `, statsParams),
            connectDB.query(`
              SELECT assigned, COUNT(*)::int AS count
              FROM leads
              ${hierarchyFilter ? hierarchyFilter + ` AND assigned IS NOT NULL AND TRIM(assigned) != ''` : `WHERE assigned IS NOT NULL AND TRIM(assigned) != ''`}
              GROUP BY assigned
            `, statsParams),
        ]);

        const s = statsResult.rows[0] || {};
        const agentLeadCounts = {};
        agentCountsResult.rows.forEach((r) => {
            if (r.assigned) agentLeadCounts[r.assigned] = Number(r.count) || 0;
        });

        return res.status(200).json({
            success: true,
            data: {
                total: s.total || 0,
                newToday: s.new_today || 0,
                contacted: s.contacted || 0,
                converted: s.converted || 0,
                unassigned: s.unassigned || 0,
                stale: s.stale || 0,
                hot: s.hot || 0,
                warm: s.warm || 0,
                cold: s.cold || 0,
                avgScore: s.avg_score || 50,
                agentLeadCounts,
            },
        });
    } catch (error) {
        console.error('getLeadsStats error:', error.message);
        return res.status(500).json({ success: false, message: 'Failed to fetch stats' });
    }
};

// ─── GET /leads/:id ───────────────────────────────────────────
export const getLeadById = async (req, res) => {
    try {
        const { id } = req.params;
        const result = await connectDB.query(`
            SELECT l.*, 
                   p.name AS project_name, 
                   p.color AS project_color
            FROM leads l
            LEFT JOIN projects p ON (l.project_id = p.id::text OR l.project_id = p.name)
            WHERE l.id::text = $1::text
        `, [String(id)]);
        if (!result.rows[0]) {
            return res.status(404).json({ success: false, message: 'Lead not found' });
        }

        // Check Team Hierarchy Permission for single lead detail view
        const hierarchy = await getHierarchyAllowedAssignees(req.user);
        if (hierarchy && hierarchy.allowedList && hierarchy.allowedList.length > 0) {
            const leadAssigned = (result.rows[0].assigned || '').trim().toLowerCase();
            const allowed = hierarchy.allowedList.some((a) => a.toLowerCase() === leadAssigned) ||
                            (hierarchy.isManager && (!leadAssigned || leadAssigned === ''));
            if (!allowed) {
                return res.status(403).json({ success: false, message: 'You do not have permission to view this lead' });
            }
        }

        const activities = await connectDB.query(
            `SELECT * FROM lead_activities WHERE lead_id::text = $1::text ORDER BY COALESCE(scheduled_at, created_at) DESC LIMIT 20`,
            [String(id)]
        );

        let leadDto = toLeadDTO(result.rows[0]);
        const scoringConfig = await getScoringConfigFromDb();
        if (scoringConfig.method === 'automatic') {
            const evaluated = calculateLeadScore({ ...leadDto, activities: activities.rows }, scoringConfig);
            leadDto.score = evaluated.score;
            leadDto.scoreFactors = evaluated.scoreFactors;

            // Sync with DB if updated
            if (result.rows[0].score !== evaluated.score || JSON.stringify(result.rows[0].score_factors) !== JSON.stringify(evaluated.scoreFactors)) {
                connectDB.query('UPDATE public.leads SET score = $1, score_factors = $2 WHERE id::text = $3::text', [
                    evaluated.score,
                    JSON.stringify(evaluated.scoreFactors),
                    String(id)
                ]).catch(() => {});
            }
        }

        return res.status(200).json({
            success: true,
            data: { ...leadDto, activities: activities.rows },
        });
    } catch (error) {
        console.error('getLeadById error:', error.message);
        return res.status(200).json({ success: false, message: 'Failed to fetch lead', error: error.message, stack: error.stack });
    }
};

// ─── POST /leads ──────────────────────────────────────────────
export const createLead = async (req, res) => {
    try {
        const {
            name, company, phone, email, source, stage, priority,
            assigned, industry, value, score, scoreFactors, tags, notes,
            projectId, project_id,
            customFields, custom_fields, extraFields, extra_fields,
        } = req.body;

        if (!name?.trim()) return res.status(400).json({ success: false, message: 'Name is required' });

        const finalCustomFields = customFields !== undefined ? customFields : (custom_fields !== undefined ? custom_fields : {});
        const finalExtraFields = extraFields !== undefined ? extraFields : (extra_fields !== undefined ? extra_fields : {});
        const finalProjectId = projectId !== undefined ? projectId : project_id;

        // Calculate dynamic lead score based on active scoring rules
        const scoringConfig = await getScoringConfigFromDb();
        let computedScore = score;
        let computedFactors = scoreFactors;

        if (scoringConfig.method === 'automatic' || score === undefined || score === null) {
            const evaluated = calculateLeadScore({
                name, company, phone, email, source, stage, priority, value, industry,
                project_id: finalProjectId,
            }, scoringConfig);
            computedScore = evaluated.score;
            computedFactors = evaluated.scoreFactors;
        }

        // Dynamic Lead Assignment based on active rules & strategy
        let finalAssigned = assigned?.trim() || null;
        let assignmentReason = null;
        if (!finalAssigned || finalAssigned === 'Unassigned' || finalAssigned === 'Auto') {
            const assignmentResult = await determineLeadAssignee({
                name: name.trim(),
                company,
                source,
                priority,
                value,
                industry,
                custom_fields: finalCustomFields,
                extra_fields: finalExtraFields,
            });
            if (assignmentResult?.assigned) {
                finalAssigned = assignmentResult.assigned;
                assignmentReason = assignmentResult.reason;
            }
        }

        const companyId = req.user?.company_id || req.user?.companyId || req.company_id || req.body?.company_id || null;

        const result = await connectDB.query(
            `INSERT INTO leads (
        name, company, phone, email, source, stage, priority,
        assigned, industry, value, score, score_factors, tags, notes,
        project_id, custom_fields, extra_fields, company_id,
        last_activity, created_at, updated_at
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,NOW(),NOW(),NOW())
      RETURNING *`,
            [
                name.trim(),
                company?.trim() || '',
                phone?.trim() || '',
                email?.trim() ? email.trim().toLowerCase() : '',
                source || 'Manual',
                stage || 'New Inquiry',
                priority || 'Medium',
                finalAssigned,
                industry || null,
                value || '₹0',
                computedScore ?? 50,
                JSON.stringify(computedFactors || []),
                JSON.stringify(tags || []),
                notes || null,
                finalProjectId || null,
                JSON.stringify(finalCustomFields),
                JSON.stringify(finalExtraFields),
                companyId,
            ]
        );

        // Log activity
        const assignedUser = finalAssigned || req.user?.name || 'System';
        const createdDetail = `Source: ${source || 'Manual'} • Score: ${computedScore ?? 50}${finalAssigned ? ` • Assigned to ${finalAssigned}` : ''}`;

        await connectDB.query(
            `INSERT INTO lead_activities (lead_id, type, description, performed_by) VALUES ($1, $2, $3, $4)`,
            [result.rows[0].id, 'created', 'Lead created', assignedUser]
        ).catch(() => {});

        await logActivity({
            type: 'lead_created',
            title: 'Lead created',
            description: createdDetail,
            userName: assignedUser,
            action: 'created a lead',
            leadName: name.trim(),
            leadId: result.rows[0].id,
            detail: createdDetail,
        });

        // Trigger WhatsApp AI Sales Bot Greeting if source is bot-enabled
        import('../bot/bot-engine.js').then((m) => {
            m.handleLeadCreated(result.rows[0].id, req.company_id || req.user?.company_id);
        }).catch((e) => console.error('[Bot Trigger Error]:', e.message));

        // Trigger Workflows event bus (lead_created)
        import('../workflows/workflow-events.js').then((w) => {
            w.emitLeadCreated(result.rows[0], req.company_id || req.user?.company_id || result.rows[0].company_id);
        }).catch((e) => console.error('[Workflow Trigger Error]:', e.message));

        return res.status(201).json({
            success: true,
            message: 'Lead created successfully',
            data: toLeadDTO(result.rows[0]),
        });
    } catch (error) {
        console.error('createLead error:', error.message);
        return res.status(500).json({ success: false, message: 'Failed to create lead', error: process.env.NODE_ENV === 'development' ? error.message : undefined });
    }
};

// ─── PATCH /leads/:id ─────────────────────────────────────────
export const updateLead = async (req, res) => {
    try {
        const { id } = req.params;

        const existing = await connectDB.query(`SELECT * FROM leads WHERE id::text = $1::text`, [String(id)]);
        if (!existing.rows[0]) {
            return res.status(404).json({ success: false, message: 'Lead not found' });
        }
        const oldLead = existing.rows[0];

        const {
            name, company, phone, email, source, stage, priority,
            assigned, industry, value, score, scoreFactors, tags, notes,
            projectId, project_id,
            customFields, custom_fields, extraFields, extra_fields,
        } = req.body;

        const scoringConfig = await getScoringConfigFromDb();
        let nextScore = score;
        let nextScoreFactors = scoreFactors;

        // If scoring is automatic and score wasn't manually overridden, recalculate dynamically
        if (scoringConfig.method === 'automatic' && score === undefined) {
            const actRes = await connectDB.query(
                `SELECT type, description, created_at FROM lead_activities WHERE lead_id::text = $1::text ORDER BY created_at DESC LIMIT 20`,
                [String(id)]
            ).catch(() => ({ rows: [] }));

            const mergedData = {
                ...oldLead,
                name: name !== undefined ? name : oldLead.name,
                company: company !== undefined ? company : oldLead.company,
                phone: phone !== undefined ? phone : oldLead.phone,
                email: email !== undefined ? email : oldLead.email,
                source: source !== undefined ? source : oldLead.source,
                stage: stage !== undefined ? stage : oldLead.stage,
                priority: priority !== undefined ? priority : oldLead.priority,
                value: value !== undefined ? value : oldLead.value,
                industry: industry !== undefined ? industry : oldLead.industry,
                project_id: projectId !== undefined ? projectId : (project_id !== undefined ? project_id : oldLead.project_id),
                custom_fields: customFields !== undefined ? customFields : (custom_fields !== undefined ? custom_fields : oldLead.custom_fields),
                extra_fields: extraFields !== undefined ? extraFields : (extra_fields !== undefined ? extra_fields : oldLead.extra_fields),
                activities: actRes.rows || [],
            };
            const evaluated = calculateLeadScore(mergedData, scoringConfig);
            nextScore = evaluated.score;
            nextScoreFactors = evaluated.scoreFactors;
        }

        const sets = [];
        const values = [];
        let idx = 1;

        const addField = (col, val) => { if (val !== undefined) { sets.push(`${col} = $${idx}`); values.push(val); idx++; } };

        addField('name', name?.trim());
        addField('company', company?.trim());
        addField('phone', phone?.trim());
        addField('email', email?.trim().toLowerCase());
        addField('source', source);
        addField('stage', stage);
        addField('priority', priority);
        addField('assigned', assigned);
        addField('industry', industry);
        addField('value', value);
        addField('score', nextScore);
        addField('notes', notes);
        addField('project_id', projectId !== undefined ? projectId : project_id);
        if (nextScoreFactors !== undefined) { sets.push(`score_factors = $${idx}`); values.push(JSON.stringify(nextScoreFactors)); idx++; }
        if (tags !== undefined) { sets.push(`tags = $${idx}`); values.push(JSON.stringify(tags)); idx++; }
        const mergedCustomFields = customFields !== undefined ? customFields : custom_fields;
        if (mergedCustomFields !== undefined) { sets.push(`custom_fields = $${idx}`); values.push(JSON.stringify(mergedCustomFields)); idx++; }
        const mergedExtraFields = extraFields !== undefined ? extraFields : extra_fields;
        if (mergedExtraFields !== undefined) { sets.push(`extra_fields = $${idx}`); values.push(JSON.stringify(mergedExtraFields)); idx++; }

        const nextActAt = req.body.nextActivityAt !== undefined ? req.body.nextActivityAt : req.body.next_activity_at;
        if (nextActAt !== undefined) { addField('next_activity_at', nextActAt); }
        const schedType = req.body.scheduledActivityType !== undefined ? req.body.scheduledActivityType : req.body.scheduled_activity_type;
        if (schedType !== undefined) { addField('scheduled_activity_type', schedType); }
        const schedNote = req.body.scheduledActivityNote !== undefined ? req.body.scheduledActivityNote : req.body.scheduled_activity_note;
        if (schedNote !== undefined) { addField('scheduled_activity_note', schedNote); }

        sets.push(`last_activity = NOW()`);
        sets.push(`updated_at = NOW()`);
        values.push(String(id));

        const result = await connectDB.query(
            `UPDATE leads SET ${sets.join(', ')} WHERE id::text = $${idx}::text RETURNING *`,
            values
        );

        // Log activity
        const updatedRow = result.rows[0];
        const performer = req.user?.name || updatedRow.assigned || 'System';

        let actType = 'note';
        let actAction = 'updated';
        let actDetail = 'Lead details updated';

        if (stage && stage !== oldLead.stage) {
            actType = 'stage_change';
            actAction = 'moved';
            actDetail = `${oldLead.stage || 'New Inquiry'} → ${stage}`;
        } else if (assigned && assigned !== oldLead.assigned) {
            actType = 'assignment';
            actAction = oldLead.assigned ? 'reassigned' : 'assigned';
            actDetail = oldLead.assigned ? `From ${oldLead.assigned} to ${assigned}` : `Assigned to ${assigned}`;
        } else if (score !== undefined && score !== oldLead.score) {
            actType = 'score_change';
            actAction = 'score changed for';
            const cat = score >= 80 ? 'Became Hot Lead' : score >= 50 ? 'Warm Lead' : 'Cold Lead';
            actDetail = `Score: ${oldLead.score ?? 50} → ${score} • ${cat}`;
        } else if (notes && notes !== oldLead.notes) {
            actType = 'note';
            actAction = 'added a note on';
            actDetail = notes.slice(0, 150);
        }

        await connectDB.query(
            `INSERT INTO lead_activities (lead_id, type, description, performed_by) VALUES ($1, $2, $3, $4)`,
            [id, actType, actDetail, performer]
        ).catch(() => {});

        await logActivity({
            type: actType,
            title: `${actType.replace('_', ' ')} logged`,
            description: actDetail,
            userName: performer,
            action: actAction,
            leadName: updatedRow.name,
            leadId: id,
            detail: actDetail,
        });

        // Trigger Workflows event hooks
        const targetCompanyId = req.company_id || req.user?.company_id || updatedRow.company_id;
        if (targetCompanyId) {
            import('../workflows/workflow-events.js').then((w) => {
                if (stage && stage !== oldLead.stage) {
                    w.emitStageChanged(updatedRow, oldLead.stage, stage, targetCompanyId);
                }
                if (assigned && assigned !== oldLead.assigned) {
                    w.emitLeadAssigned(updatedRow, assigned, targetCompanyId);
                }
                if (score !== undefined && score !== oldLead.score) {
                    w.emitScoreCrossed(updatedRow, score, oldLead.score, targetCompanyId);
                }
                if (tags !== undefined) {
                    w.emitTagAdded(updatedRow, tags, targetCompanyId);
                }
            }).catch((e) => console.error('[Workflow Event Trigger Error]:', e.message));
        }

        return res.status(200).json({
            success: true,
            message: 'Lead updated successfully',
            data: toLeadDTO(result.rows[0]),
        });
    } catch (error) {
        console.error('updateLead error:', error.message);
        return res.status(500).json({ success: false, message: 'Failed to update lead', error: process.env.NODE_ENV === 'development' ? error.message : undefined });
    }
};

// ─── DELETE /leads/:id ────────────────────────────────────────
export const deleteLead = async (req, res) => {
    try {
        const { id } = req.params;
        const result = await connectDB.query(`DELETE FROM leads WHERE id::text = $1::text RETURNING id, name`, [String(id)]);
        if (!result.rows[0]) {
            return res.status(404).json({ success: false, message: 'Lead not found' });
        }

        const deletedLead = result.rows[0];
        await logActivity({
            type: 'lead_deleted',
            title: 'Lead deleted',
            description: `Lead "${deletedLead.name}" was deleted`,
            userName: req.user?.name || 'Admin',
            action: 'deleted lead',
            leadName: deletedLead.name,
            leadId: id,
            detail: `Lead "${deletedLead.name}" removed from CRM`,
        });

        return res.status(200).json({
            success: true,
            message: 'Lead deleted successfully',
            data: deletedLead,
        });
    } catch (error) {
        console.error('deleteLead error:', error.message);
        return res.status(500).json({ success: false, message: 'Failed to delete lead' });
    }
};

// ─── DELETE /leads/bulk ───────────────────────────────────────
export const bulkDeleteLeads = async (req, res) => {
    try {
        const { ids } = req.body;
        if (!Array.isArray(ids) || ids.length === 0) {
            return res.status(400).json({ success: false, message: 'ids array is required' });
        }

        const stringIds = ids.map((id) => String(id));
        const result = await connectDB.query(
            `DELETE FROM leads WHERE id::text = ANY($1::text[]) RETURNING id, name`,
            [stringIds]
        );

        await logActivity({
            type: 'lead_deleted',
            title: 'Bulk leads deleted',
            description: `Deleted ${result.rows.length} leads`,
            userName: req.user?.name || 'Admin',
            action: 'deleted leads',
            leadName: `${result.rows.length} Leads`,
            detail: `Deleted IDs: ${result.rows.map((r) => r.id).join(', ')}`,
        });

        return res.status(200).json({
            success: true,
            message: `${result.rows.length} lead(s) deleted`,
            data: { deletedIds: result.rows.map((r) => r.id) },
        });
    } catch (error) {
        console.error('bulkDeleteLeads error:', error.message);
        return res.status(500).json({ success: false, message: 'Failed to delete leads' });
    }
};

// ─── PATCH /leads/bulk/assign ─────────────────────────────────
export const bulkAssignLeads = async (req, res) => {
    try {
        const { ids, assigned } = req.body;
        if (!Array.isArray(ids) || ids.length === 0) {
            return res.status(400).json({ success: false, message: 'ids array is required' });
        }
        if (!assigned?.trim()) {
            return res.status(400).json({ success: false, message: 'assigned agent name is required' });
        }

        const stringIds = ids.map((id) => String(id));
        const result = await connectDB.query(
            `UPDATE leads SET assigned = $1, last_activity = NOW(), updated_at = NOW()
       WHERE id::text = ANY($2::text[]) RETURNING id, name`,
            [assigned.trim(), stringIds]
        );

        await logActivity({
            type: 'assignment',
            title: 'Bulk leads assigned',
            description: `Assigned ${result.rows.length} lead(s) to ${assigned}`,
            userName: req.user?.name || 'Admin',
            action: 'assigned',
            leadName: `${result.rows.length} Leads`,
            detail: `Assigned to ${assigned}`,
        });

        return res.status(200).json({
            success: true,
            message: `${result.rows.length} lead(s) assigned to ${assigned}`,
            data: { updatedIds: result.rows.map((r) => r.id) },
        });
    } catch (error) {
        console.error('bulkAssignLeads error:', error.message);
        return res.status(500).json({ success: false, message: 'Failed to assign leads' });
    }
};

// ─── PATCH /leads/bulk/stage ──────────────────────────────────
export const bulkChangeStage = async (req, res) => {
    try {
        const { ids, stage } = req.body;
        if (!Array.isArray(ids) || ids.length === 0) {
            return res.status(400).json({ success: false, message: 'ids array is required' });
        }
        if (!stage?.trim()) {
            return res.status(400).json({ success: false, message: 'stage is required' });
        }

        const stringIds = ids.map((id) => String(id));
        const result = await connectDB.query(
            `UPDATE leads SET stage = $1, last_activity = NOW(), updated_at = NOW()
       WHERE id::text = ANY($2::text[]) RETURNING id, name`,
            [stage.trim(), stringIds]
        );

        // Recalculate scores for leads moved to new stage
        const scoringConfig = await getScoringConfigFromDb().catch(() => null);
        if (scoringConfig && scoringConfig.method === 'automatic') {
            connectDB.query(`SELECT * FROM leads WHERE id::text = ANY($1::text[])`, [stringIds])
                .then(async (leadsRes) => {
                    for (const l of leadsRes.rows) {
                        const { score: newScore, scoreFactors: newFactors } = calculateLeadScore({ ...l, stage: stage.trim() }, scoringConfig);
                        await connectDB.query(`UPDATE leads SET score = $1, score_factors = $2 WHERE id::text = $3::text`, [
                            newScore, JSON.stringify(newFactors), String(l.id)
                        ]).catch(() => {});
                    }
                })
                .catch(() => {});
        }

        await logActivity({
            type: 'stage_change',
            title: 'Bulk stage changed',
            description: `Moved ${result.rows.length} lead(s) to ${stage}`,
            userName: req.user?.name || 'Admin',
            action: 'moved',
            leadName: `${result.rows.length} Leads`,
            detail: `Stage moved to ${stage}`,
        });

        return res.status(200).json({
            success: true,
            message: `${result.rows.length} lead(s) moved to ${stage}`,
            data: { updatedIds: result.rows.map((r) => r.id) },
        });
    } catch (error) {
        console.error('bulkChangeStage error:', error.message);
        return res.status(500).json({ success: false, message: 'Failed to change stage' });
    }
};

// ─── PATCH /leads/auto-assign ─────────────────────────────────
export const autoAssignLeads = async (req, res) => {
    try {
        const { agents } = req.body; // ['Rajesh Kumar', 'Priya Sharma', ...]

        if (!Array.isArray(agents) || agents.length === 0) {
            return res.status(400).json({ success: false, message: 'agents array is required' });
        }

        // Get unassigned leads with full attributes
        const unassigned = await connectDB.query(
            `SELECT * FROM leads WHERE assigned IS NULL OR assigned = '' OR assigned = 'Unassigned' ORDER BY created_at ASC`
        );

        if (unassigned.rows.length === 0) {
            return res.status(200).json({ success: true, message: 'No unassigned leads found', data: { assigned: 0 } });
        }

        let assignedCount = 0;
        for (const lead of unassigned.rows) {
            const assignmentResult = await determineLeadAssignee(lead);
            const chosenAgent = assignmentResult?.assigned || agents[assignedCount % agents.length];
            if (chosenAgent) {
                await connectDB.query(
                    `UPDATE leads SET assigned = $1, last_activity = NOW(), updated_at = NOW() WHERE id::text = $2::text`,
                    [chosenAgent, String(lead.id)]
                );
                await connectDB.query(
                    `INSERT INTO lead_activities (lead_id, type, description, performed_by) VALUES ($1, $2, $3, $4)`,
                    [lead.id, 'assignment', `Lead assigned to ${chosenAgent} (${assignmentResult?.reason || 'Auto-balance'})`, req.user?.name || 'System']
                ).catch(() => {});
                assignedCount++;
            }
        }

        await logActivity({
            type: 'assignment',
            title: 'Leads auto-balanced',
            description: `${assignedCount} leads auto-assigned across team`,
            userName: req.user?.name || 'Admin',
            action: 'assigned',
            leadName: `${assignedCount} Leads`,
            detail: `Distributed using active assignment rules & strategy`,
        });

        return res.status(200).json({
            success: true,
            message: `${assignedCount} leads auto-assigned`,
            data: { assigned: assignedCount },
        });
    } catch (error) {
        console.error('autoAssignLeads error:', error.message);
        return res.status(500).json({ success: false, message: 'Auto-assign failed' });
    }
};

// ─── PATCH /leads/reassign-agent ──────────────────────────────
export const reassignAgentLeads = async (req, res) => {
    try {
        const { fromAgent, toAgent } = req.body;
        if (!fromAgent?.trim() || !toAgent?.trim()) {
            return res.status(400).json({ success: false, message: 'fromAgent and toAgent are required' });
        }

        const result = await connectDB.query(
            `UPDATE leads SET assigned = $1, last_activity = NOW(), updated_at = NOW()
             WHERE assigned = $2 RETURNING id`,
            [toAgent.trim(), fromAgent.trim()]
        );

        if (result.rows.length > 0) {
            const initials = toAgent.trim().split(' ').map((n) => n[0]).join('').toUpperCase().slice(0, 3);
            await connectDB.query(
                `INSERT INTO public.activities (type, title, description, user_name, user_initials, action, lead_name, detail, timestamp)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())`,
                [
                    'assignment',
                    'Leads reassigned',
                    `Reassigned ${result.rows.length} lead(s) from ${fromAgent} to ${toAgent}`,
                    toAgent.trim(),
                    initials,
                    'reassigned',
                    `${result.rows.length} Leads`,
                    `From ${fromAgent} to ${toAgent}`,
                ]
            ).catch(() => {});
        }

        return res.status(200).json({
            success: true,
            message: `${result.rows.length} lead(s) reassigned from ${fromAgent} to ${toAgent}`,
            data: { count: result.rows.length, updatedIds: result.rows.map((r) => r.id) },
        });
    } catch (error) {
        console.error('reassignAgentLeads error:', error.message);
        return res.status(500).json({ success: false, message: 'Failed to reassign leads' });
    }
};

// ─── POST /leads/:id/activities ──────────────────────────────
export const addLeadActivity = async (req, res) => {
    try {
        const { id } = req.params;
        const { type, description, performedBy, performed_by, date, time } = req.body;

        if (!type || !description) {
            return res.status(400).json({ success: false, message: 'type and description are required' });
        }

        const finalPerformer = performedBy || performed_by || req.user?.name || 'System';

        // Parse scheduled date and time
        let scheduledAt = new Date();
        let activityDate = null;
        let activityTime = time || null;

        if (date) {
            activityDate = date;
            if (time) {
                let hours = 0;
                let minutes = 0;
                const timeMatch = time.match(/(\d+):(\d+)\s*(AM|PM)?/i);
                if (timeMatch) {
                    hours = parseInt(timeMatch[1], 10);
                    minutes = parseInt(timeMatch[2], 10);
                    const meridiem = timeMatch[3]?.toUpperCase();
                    if (meridiem === 'PM' && hours < 12) hours += 12;
                    if (meridiem === 'AM' && hours === 12) hours = 0;
                }
                const parts = date.split('-').map(Number);
                if (parts.length === 3) {
                    scheduledAt = new Date(parts[0], parts[1] - 1, parts[2], hours, minutes, 0);
                } else {
                    scheduledAt = new Date(`${date} ${time}`);
                }
            } else {
                scheduledAt = new Date(date);
            }
        }
        if (isNaN(scheduledAt.getTime())) {
            scheduledAt = new Date();
        }

        const result = await connectDB.query(
            `INSERT INTO lead_activities (lead_id, type, description, performed_by, activity_date, activity_time, scheduled_at) 
             VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
            [id, type, description, finalPerformer, activityDate, activityTime, scheduledAt]
        );

        if (date) {
            // Explicit scheduled follow-up / reminder
            await connectDB.query(
                `UPDATE leads SET 
                    last_activity = NOW(), 
                    next_activity_at = $1, 
                    scheduled_activity_type = $2, 
                    scheduled_activity_note = $3, 
                    updated_at = NOW() 
                 WHERE id::text = $4::text`, 
                [scheduledAt, type, description, String(id)]
            );
        } else {
            // General activity (e.g. stage change or note): update last_activity only
            await connectDB.query(
                `UPDATE leads SET 
                    last_activity = NOW(), 
                    updated_at = NOW() 
                 WHERE id::text = $1::text`, 
                [String(id)]
            );
        }

        // Get lead name for central activities & notifications
        const leadRes = await connectDB.query(`SELECT name FROM leads WHERE id::text = $1::text`, [String(id)]);
        const leadName = leadRes.rows[0]?.name || 'Lead';

        // Insert Notification for activity / reminder
        const notifType = (type.toLowerCase().includes('call') ? 'call' :
                           type.toLowerCase().includes('whatsapp') ? 'whatsapp' :
                           'alert');

        try {
            await connectDB.query(
                `INSERT INTO public.notifications (type, title, description, lead_id, lead_name, activity_id, scheduled_at, read, created_at)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, false, NOW())`,
                [
                    notifType,
                    `${type} Scheduled: ${leadName}`,
                    `${description}${activityDate ? ` (${activityDate}${activityTime ? ' at ' + activityTime : ''})` : ''}`,
                    id,
                    leadName,
                    result.rows[0].id,
                    scheduledAt,
                ]
            );
        } catch (notifErr) {
            console.warn('Failed to insert notification with activity_id, attempting fallback without activity_id:', notifErr.message);
            // Attempt auto-migration of missing column in background
            connectDB.query('ALTER TABLE public.notifications ADD COLUMN IF NOT EXISTS activity_id VARCHAR(100)').catch(() => {});
            await connectDB.query(
                `INSERT INTO public.notifications (type, title, description, lead_id, lead_name, scheduled_at, read, created_at)
                 VALUES ($1, $2, $3, $4, $5, false, NOW())`,
                [
                    notifType,
                    `${type} Scheduled: ${leadName}`,
                    `${description}${activityDate ? ` (${activityDate}${activityTime ? ' at ' + activityTime : ''})` : ''}`,
                    id,
                    leadName,
                    scheduledAt,
                ]
            ).catch((err2) => {
                console.error('Notification fallback insert error:', err2.message);
            });
        }

        await logActivity({
            type,
            title: `${type} scheduled`,
            description,
            userName: finalPerformer,
            leadName,
            leadId: id,
            detail: `${description}${activityDate ? ` [${activityDate} ${activityTime || ''}]` : ''}`,
        });

        return res.status(201).json({
            success: true,
            data: result.rows[0],
        });
    } catch (error) {
        console.error('addLeadActivity error:', error.message);
        return res.status(500).json({ success: false, message: 'Failed to add activity' });
    }
};

// ─── PATCH /leads/:id/dismiss-reminder ────────────────────────
export const dismissLeadReminder = async (req, res) => {
    try {
        const { id } = req.params;
        await connectDB.query(
            `UPDATE leads SET 
                next_activity_at = NULL, 
                scheduled_activity_type = NULL, 
                scheduled_activity_note = NULL,
                updated_at = NOW() 
             WHERE id::text = $1::text`,
            [String(id)]
        );
        await connectDB.query(
            `UPDATE lead_activities SET 
                scheduled_at = NULL,
                activity_date = NULL,
                activity_time = NULL
             WHERE lead_id::text = $1::text`,
            [String(id)]
        ).catch(() => {});
        return res.status(200).json({ success: true, message: 'Reminder marked completed' });
    } catch (error) {
        console.error('dismissLeadReminder error:', error.message);
        return res.status(500).json({ success: false, message: 'Failed to dismiss reminder' });
    }
};