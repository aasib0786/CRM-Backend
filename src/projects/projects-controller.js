import { randomUUID } from 'crypto';
import connectDB from '../pool.js';
import { logActivity } from '../activities/activityLogger.js';

const isUUID = (str) => typeof str === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(str);

export const isSoldStage = (stage) => {
  if (!stage) return false;
  const s = String(stage).toLowerCase().trim();
  return (
    s === 'sold' ||
    s === 'closed won' ||
    s === 'won' ||
    s === 'deal won' ||
    s === 'converted' ||
    s.includes('closed won') ||
    s.includes('deal won') ||
    s.includes('sold')
  );
};

export const isBookingStage = (stage) => {
  if (!stage) return false;
  const s = String(stage).toLowerCase().trim();
  if (isSoldStage(s)) return false;
  return (
    s === 'booking' ||
    s === 'booking done' ||
    s === 'booked' ||
    s === 'under booking' ||
    s === 'token' ||
    s.includes('book')
  );
};

export const isInterestedStage = (stage) => {
  if (!stage) return false;
  const s = String(stage).toLowerCase().trim();
  if (
    isBookingStage(s) ||
    isSoldStage(s) ||
    s === 'lost' ||
    s.includes('lost') ||
    s === 'junk' ||
    s === 'not interested' ||
    s === 'dropped' ||
    s === 'new lead' ||
    s === 'new inquiry' ||
    s === 'inquiry' ||
    s === 'new'
  ) {
    return false;
  }
  return (
    s.includes('interest') ||
    s.includes('site visit') ||
    s.includes('proposal') ||
    s.includes('negotiat') ||
    s.includes('meeting') ||
    s.includes('discussion') ||
    s.includes('follow up') ||
    s.includes('contact') ||
    s.includes('visit')
  );
};

// ── Projects CRUD ──

export const getProjects = async (req, res) => {
  try {
    const { rows: projects } = await connectDB.query(`SELECT * FROM public.projects ORDER BY created_at DESC NULLS LAST`);

    // Fetch all project inventory to compute dynamic counts per project
    const { rows: inventoryRows } = await connectDB.query(`SELECT id, project_id, data FROM public.project_inventory`);

    // Fetch all leads to compute dynamic lead counts per project
    const { rows: leadsRows } = await connectDB.query(`SELECT id, name, project_id, stage FROM public.leads`);

    // Group inventory by project
    const inventoryByProj = {};
    for (const inv of inventoryRows) {
      if (!inv.project_id) continue;
      const pid = String(inv.project_id);
      if (!inventoryByProj[pid]) inventoryByProj[pid] = [];
      const d = typeof inv.data === 'string' ? JSON.parse(inv.data) : (inv.data || {});
      inventoryByProj[pid].push({ id: inv.id, ...d });
    }

    const formatted = projects.map((r) => {
      const pid = String(r.id);
      const projInventory = inventoryByProj[pid] || [];
      const projLeads = leadsRows.filter(l => 
        String(l.project_id) === pid || 
        String(l.project_id).toLowerCase() === String(r.name).toLowerCase()
      );

      // Lead lookup map to sync inventory unit status
      const leadMap = new Map();
      projLeads.forEach(l => {
        leadMap.set(String(l.id), l);
        if (l.name) leadMap.set(String(l.name).toLowerCase(), l);
      });

      const totalInventory = projInventory.length;
      let inventoryBooked = 0;
      let inventorySold = 0;

      for (const it of projInventory) {
        let s = (it.status || '').toLowerCase();
        const linkedLead = it.lead_id ? leadMap.get(String(it.lead_id)) : (it.leadName ? leadMap.get(String(it.leadName).toLowerCase()) : null);
        if (linkedLead) {
          if (isSoldStage(linkedLead.stage)) {
            s = 'sold';
          } else if (isBookingStage(linkedLead.stage)) {
            s = 'booked';
          }
        }

        if (s === 'sold' || s === 'enrolled' || s === 'active clients' || s === 'out of stock' || s.includes('sold')) {
          inventorySold++;
        } else if (s === 'booked' || s.includes('book')) {
          inventoryBooked++;
        }
      }

      const bookedLeads = projLeads.filter(l => isBookingStage(l.stage)).length;
      const soldLeads = projLeads.filter(l => isSoldStage(l.stage)).length;
      const interestedLeads = projLeads.filter(l => isInterestedStage(l.stage)).length;

      const dynamicLeadsCount = projLeads.length > 0 ? projLeads.length : parseInt(r.leads || 0, 10);
      const effectiveBooked = Math.max(inventoryBooked, bookedLeads);
      const effectiveSold = Math.max(inventorySold, soldLeads);

      const dynamicBookedCount = effectiveBooked;
      const dynamicSoldCount = effectiveSold;
      const dynamicInterestedCount = interestedLeads;

      const totalOccupied = dynamicBookedCount + dynamicSoldCount;
      const available = Math.max(0, totalInventory - totalOccupied);

      let dynamicProgress = 0;
      if (totalInventory > 0) {
        dynamicProgress = Math.min(100, Math.round((totalOccupied / totalInventory) * 100));
      } else if (dynamicLeadsCount > 0) {
        dynamicProgress = Math.min(100, Math.round((totalOccupied / dynamicLeadsCount) * 100));
      } else {
        dynamicProgress = parseInt(r.progress || 0, 10);
      }

      return {
        id: r.id,
        name: r.name,
        category: r.category || 'properties',
        sellingTypeId: r.selling_type_id,
        status: r.status || 'Active',
        color: r.color || 'indigo',
        description: r.description || '',
        leads: dynamicLeadsCount,
        interested: dynamicInterestedCount,
        booked: dynamicBookedCount,
        sold: dynamicSoldCount,
        progress: dynamicProgress,
        totalInventory,
        availableCount: available,
        bookedCount: dynamicBookedCount,
        soldCount: dynamicSoldCount,
        customFields: typeof r.custom_fields === 'string' ? JSON.parse(r.custom_fields) : (r.custom_fields || {}),
        client_name: r.client_name || '',
        start_date: r.start_date || '',
        due_date: r.due_date || '',
        budget: parseFloat(r.budget || 0),
        spent: parseFloat(r.spent || 0),
        team_members: typeof r.team_members === 'string' ? JSON.parse(r.team_members) : (r.team_members || []),
        documents: typeof r.documents === 'string' ? JSON.parse(r.documents) : (r.documents || []),
        createdAt: r.created_at,
      };
    });

    return res.status(200).json({ success: true, count: formatted.length, data: formatted });
  } catch (err) {
    console.error("getProjects error:", err);
    return res.status(500).json({ success: false, message: err.message });
  }
};

export const getProjectById = async (req, res) => {
  try {
    const { id } = req.params;
    const projectRes = await connectDB.query(`SELECT * FROM public.projects WHERE id = $1`, [id]);
    if (!projectRes.rows.length) return res.status(404).json({ success: false, message: 'Project not found' });

    const inventoryRes = await connectDB.query(`SELECT * FROM public.project_inventory WHERE project_id = $1 ORDER BY created_at DESC`, [id]);
    const tasksRes = await connectDB.query(`SELECT * FROM public.project_tasks WHERE project_id = $1 ORDER BY id DESC`, [id]);

    // Fetch linked leads
    const project = projectRes.rows[0];
    const leadsRes = await connectDB.query(
      `SELECT * FROM public.leads WHERE project_id = $1 OR project_id = $2 ORDER BY created_at DESC`,
      [String(id), String(project.name)]
    );

    // Fetch quotations associated with these leads
    const leadIds = leadsRes.rows.map(l => String(l.id));
    const leadNames = leadsRes.rows.map(l => l.name).filter(Boolean);
    let quotationsRes = { rows: [] };
    if (leadIds.length > 0 || leadNames.length > 0 || project.client_name || project.name) {
      quotationsRes = await connectDB.query(
        `SELECT * FROM public.quotations 
         WHERE (lead_id = ANY($1::varchar[]) AND lead_id IS NOT NULL)
            OR (client_name = ANY($2::varchar[]) AND client_name IS NOT NULL)
            OR (client_name = $3 AND $3 <> '')
            OR (client_name = $4 AND $4 <> '')
         ORDER BY created_at DESC`,
        [leadIds.length > 0 ? leadIds : ['__NONE__'], leadNames.length > 0 ? leadNames : ['__NONE__'], project.client_name || '', project.name || '']
      ).catch(() => ({ rows: [] }));
    }

    // Lead lookup map to sync inventory unit status
    const leadMap = new Map();
    leadsRes.rows.forEach(l => {
      leadMap.set(String(l.id), l);
      if (l.name) leadMap.set(String(l.name).toLowerCase(), l);
    });

    const inventory = inventoryRes.rows.map((inv) => {
      const d = typeof inv.data === 'string' ? JSON.parse(inv.data) : (inv.data || {});
      const linkedLead = d.lead_id ? leadMap.get(String(d.lead_id)) : (d.leadName ? leadMap.get(String(d.leadName).toLowerCase()) : null);
      let status = d.status || 'Available';
      if (linkedLead) {
        if (isSoldStage(linkedLead.stage)) {
          status = 'Sold';
        } else if (isBookingStage(linkedLead.stage)) {
          status = 'Booked';
        }
      }
      return {
        id: inv.id,
        ...d,
        status,
      };
    });

    const totalInventory = inventory.length;
    let inventoryBooked = 0;
    let inventorySold = 0;

    for (const it of inventory) {
      const s = (it.status || '').toLowerCase();
      if (s === 'sold' || s === 'enrolled' || s === 'active clients' || s === 'out of stock' || s.includes('sold')) {
        inventorySold++;
      } else if (s === 'booked' || s.includes('book')) {
        inventoryBooked++;
      }
    }

    const bookedLeads = leadsRes.rows.filter(l => isBookingStage(l.stage)).length;
    const soldLeads = leadsRes.rows.filter(l => isSoldStage(l.stage)).length;
    const interestedLeads = leadsRes.rows.filter(l => isInterestedStage(l.stage)).length;

    const effectiveBooked = Math.max(inventoryBooked, bookedLeads);
    const effectiveSold = Math.max(inventorySold, soldLeads);
    const totalOccupied = effectiveBooked + effectiveSold;
    const available = Math.max(0, totalInventory - totalOccupied);

    let dynamicProgress = 0;
    if (totalInventory > 0) {
      dynamicProgress = Math.min(100, Math.round((totalOccupied / totalInventory) * 100));
    } else if (leadsRes.rows.length > 0) {
      dynamicProgress = Math.min(100, Math.round((totalOccupied / leadsRes.rows.length) * 100));
    } else {
      dynamicProgress = parseInt(project.progress || 0, 10);
    }

    const formattedProject = {
      id: project.id,
      name: project.name,
      category: project.category || 'properties',
      sellingTypeId: project.selling_type_id,
      status: project.status || 'Active',
      color: project.color || 'indigo',
      description: project.description || '',
      leads: leadsRes.rows.length,
      interested: interestedLeads,
      booked: effectiveBooked,
      sold: effectiveSold,
      progress: dynamicProgress,
      totalInventory,
      availableCount: available,
      bookedCount: effectiveBooked,
      soldCount: effectiveSold,
      customFields: typeof project.custom_fields === 'string' ? JSON.parse(project.custom_fields) : (project.custom_fields || {}),
      client_name: project.client_name || '',
      start_date: project.start_date || '',
      due_date: project.due_date || '',
      budget: parseFloat(project.budget || 0),
      spent: parseFloat(project.spent || 0),
      team_members: typeof project.team_members === 'string' ? JSON.parse(project.team_members) : (project.team_members || []),
      documents: typeof project.documents === 'string' ? JSON.parse(project.documents) : (project.documents || []),
      tasks: tasksRes.rows,
      inventory,
      linkedLeads: leadsRes.rows.map(l => ({
        id: l.id,
        name: l.name,
        company: l.company || '',
        phone: l.phone || '',
        email: l.email || '',
        source: l.source || 'Manual',
        stage: l.stage || 'New Inquiry',
        priority: l.priority || 'Medium',
        assigned: l.assigned || 'Unassigned',
        score: l.score ?? 50,
        value: l.value || '₹0',
        projectId: l.project_id,
      })),
      linkedQuotations: quotationsRes.rows.map(q => ({
        id: q.id,
        quoteNumber: q.quote_number,
        clientName: q.client_name,
        totalAmount: parseFloat(q.total_amount || 0),
        status: q.status || 'Draft',
        validUntil: q.valid_until,
        createdAt: q.created_at,
      })),
    };

    return res.status(200).json({ success: true, data: formattedProject });
  } catch (err) {
    console.error("getProjectById error:", err);
    return res.status(500).json({ success: false, message: err.message });
  }
};

export const createProject = async (req, res) => {
  try {
    const {
      name,
      category = 'properties',
      sellingTypeId,
      status = 'Active',
      color = 'indigo',
      description = '',
      customFields = {},
      client_name = '',
      lead_id = null,
      budget = 0,
      spent = 0,
      start_date = null,
      due_date = null,
      team_members = [],
      documents = [],
    } = req.body;

    if (!name || !name.trim()) {
      return res.status(400).json({ success: false, message: 'Project name is required' });
    }

    const id = randomUUID();
    const { rows } = await connectDB.query(
      `INSERT INTO public.projects (id, name, category, selling_type_id, status, color, description, custom_fields, client_name, lead_id, budget, spent, start_date, due_date, team_members, documents, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, NOW()) RETURNING *`,
      [
        id,
        name.trim(),
        category,
        sellingTypeId || null,
        status,
        color,
        description,
        JSON.stringify(customFields),
        client_name || null,
        lead_id || null,
        budget || 0,
        spent || 0,
        start_date || null,
        due_date || null,
        JSON.stringify(team_members),
        JSON.stringify(documents),
      ]
    );

    const created = rows[0];

    // Log activity
    const pUser = req.user?.name || 'Admin';
    logActivity({
      type: 'project',
      title: 'Project created',
      description: `Category: ${category} • Budget: ₹${parseFloat(budget || 0).toLocaleString('en-IN')}`,
      userName: pUser,
      action: 'created project',
      leadName: created.name,
      detail: `Category: ${category} • Budget: ₹${parseFloat(budget || 0).toLocaleString('en-IN')}`,
    });

    return res.status(201).json({
      success: true,
      data: {
        id: created.id,
        name: created.name,
        category: created.category,
        sellingTypeId: created.selling_type_id,
        status: created.status,
        color: created.color,
        description: created.description,
        leads: 0,
        interested: 0,
        booked: 0,
        progress: 0,
        customFields: typeof created.custom_fields === 'string' ? JSON.parse(created.custom_fields) : (created.custom_fields || {}),
        client_name: created.client_name || '',
        budget: parseFloat(created.budget || 0),
        spent: parseFloat(created.spent || 0),
        start_date: created.start_date,
        due_date: created.due_date,
        team_members: typeof created.team_members === 'string' ? JSON.parse(created.team_members) : (created.team_members || []),
        documents: typeof created.documents === 'string' ? JSON.parse(created.documents) : (created.documents || []),
      },
    });
  } catch (err) {
    console.error("createProject error:", err);
    return res.status(500).json({ success: false, message: err.message });
  }
};

export const updateProject = async (req, res) => {
  try {
    const { id } = req.params;
    const {
      name,
      category,
      sellingTypeId,
      status,
      color,
      description,
      customFields,
      progress,
      leads,
      interested,
      booked,
      budget,
      spent,
      client_name,
      start_date,
      due_date,
      team_members,
      documents,
    } = req.body;

    const { rows } = await connectDB.query(
      `UPDATE public.projects SET
        name = COALESCE($1, name),
        category = COALESCE($2, category),
        selling_type_id = COALESCE($3, selling_type_id),
        status = COALESCE($4, status),
        color = COALESCE($5, color),
        description = COALESCE($6, description),
        custom_fields = COALESCE($7, custom_fields),
        progress = COALESCE($8, progress),
        leads = COALESCE($9, leads),
        interested = COALESCE($10, interested),
        booked = COALESCE($11, booked),
        budget = COALESCE($12, budget),
        spent = COALESCE($13, spent),
        client_name = COALESCE($14, client_name),
        start_date = COALESCE($15, start_date),
        due_date = COALESCE($16, due_date),
        team_members = COALESCE($17, team_members),
        documents = COALESCE($18, documents)
       WHERE id = $19 RETURNING *`,
      [
        name,
        category,
        sellingTypeId,
        status,
        color,
        description,
        customFields ? JSON.stringify(customFields) : null,
        progress !== undefined ? progress : null,
        leads !== undefined ? leads : null,
        interested !== undefined ? interested : null,
        booked !== undefined ? booked : null,
        budget !== undefined ? budget : null,
        spent !== undefined ? spent : null,
        client_name !== undefined ? client_name : null,
        start_date !== undefined ? (start_date || null) : null,
        due_date !== undefined ? (due_date || null) : null,
        team_members ? JSON.stringify(team_members) : null,
        documents ? JSON.stringify(documents) : null,
        id,
      ]
    );

    if (!rows.length) return res.status(404).json({ success: false, message: 'Project not found' });
    const updated = rows[0];

    // Log activity
    logActivity({
      type: 'project',
      title: 'Project updated',
      description: `${updated.name} details updated`,
      userName: req.user?.name || 'Admin',
      action: 'updated project',
      leadName: updated.name,
      detail: `Status: ${updated.status || 'Active'} • Progress: ${updated.progress || 0}%`,
    });

    return res.status(200).json({
      success: true,
      data: {
        id: updated.id,
        name: updated.name,
        category: updated.category,
        sellingTypeId: updated.selling_type_id,
        status: updated.status,
        color: updated.color,
        description: updated.description,
        leads: parseInt(updated.leads || 0, 10),
        interested: parseInt(updated.interested || 0, 10),
        booked: parseInt(updated.booked || 0, 10),
        progress: parseInt(updated.progress || 0, 10),
        customFields: typeof updated.custom_fields === 'string' ? JSON.parse(updated.custom_fields) : (updated.custom_fields || {}),
        client_name: updated.client_name || '',
        budget: parseFloat(updated.budget || 0),
        spent: parseFloat(updated.spent || 0),
        start_date: updated.start_date,
        due_date: updated.due_date,
        team_members: typeof updated.team_members === 'string' ? JSON.parse(updated.team_members) : (updated.team_members || []),
        documents: typeof updated.documents === 'string' ? JSON.parse(updated.documents) : (updated.documents || []),
      },
    });
  } catch (err) {
    console.error("updateProject error:", err);
    return res.status(500).json({ success: false, message: err.message });
  }
};

export const deleteProject = async (req, res) => {
  try {
    const { id } = req.params;
    const pRes = await connectDB.query(`SELECT name FROM public.projects WHERE id = $1`, [id]);
    const pName = pRes.rows[0]?.name || 'Project';

    // Unlink any leads attached to this project
    await connectDB.query(`UPDATE public.leads SET project_id = NULL WHERE project_id = $1`, [String(id)]).catch(() => {});
    await connectDB.query(`DELETE FROM public.projects WHERE id = $1`, [id]);

    logActivity({
      type: 'project_deleted',
      title: 'Project deleted',
      description: `Project "${pName}" was deleted`,
      userName: req.user?.name || 'Admin',
      action: 'deleted project',
      leadName: pName,
      detail: `Project "${pName}" removed`,
    });

    return res.status(200).json({ success: true, message: 'Project deleted successfully' });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

// ── Inventory Items CRUD ──

export const getInventoryItems = async (req, res) => {
  try {
    const { id: projectId } = req.params;
    const { rows } = await connectDB.query(`SELECT * FROM public.project_inventory WHERE project_id = $1 ORDER BY created_at DESC`, [projectId]);
    
    // Also fetch project leads to auto-sync inventory item status
    const pRes = await connectDB.query(`SELECT name FROM public.projects WHERE id = $1`, [projectId]).catch(() => ({ rows: [] }));
    const pName = pRes.rows[0]?.name || '';
    const leadsRes = await connectDB.query(
      `SELECT id, name, stage FROM public.leads WHERE project_id = $1 OR project_id = $2`,
      [String(projectId), String(pName)]
    ).catch(() => ({ rows: [] }));

    const leadMap = new Map();
    leadsRes.rows.forEach(l => {
      leadMap.set(String(l.id), l);
      if (l.name) leadMap.set(String(l.name).toLowerCase(), l);
    });

    const items = rows.map((inv) => {
      const d = typeof inv.data === 'string' ? JSON.parse(inv.data) : (inv.data || {});
      const unitVal = d.unit_number || d.unitNo || d.unitNumber || d.name || '';
      const areaVal = d.area_sq_ft || d.area || d.area_sqft || '';

      let itemStatus = d.status || 'Available';
      const linkedLead = d.lead_id ? leadMap.get(String(d.lead_id)) : (d.leadName ? leadMap.get(String(d.leadName).toLowerCase()) : null);
      if (linkedLead) {
        if (isSoldStage(linkedLead.stage)) {
          itemStatus = 'Sold';
        } else if (isBookingStage(linkedLead.stage)) {
          itemStatus = 'Booked';
        }
      }

      if ((!d.unit_number && unitVal) || (!d.area_sq_ft && areaVal) || (d.status !== itemStatus && linkedLead)) {
        connectDB.query(`UPDATE public.project_inventory SET data = $1 WHERE id = $2`, [
          JSON.stringify({
            ...d,
            ...(unitVal ? { unit_number: unitVal, unitNo: unitVal, unitNumber: unitVal } : {}),
            ...(areaVal ? { area_sq_ft: areaVal, area: areaVal, area_sqft: areaVal } : {}),
            status: itemStatus,
          }),
          inv.id,
        ]).catch(() => {});
      }

      return {
        id: inv.id,
        ...d,
        status: itemStatus,
        ...(unitVal && !d.unit_number ? { unit_number: unitVal } : {}),
        ...(unitVal && !d.unitNo ? { unitNo: unitVal } : {}),
        ...(areaVal && !d.area_sq_ft ? { area_sq_ft: areaVal } : {}),
        ...(areaVal && !d.area ? { area: areaVal } : {}),
      };
    });
    return res.status(200).json({ success: true, count: items.length, data: items });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

export const createInventoryItem = async (req, res) => {
  try {
    const { id: projectId } = req.params;
    const itemData = req.body || {};
    const itemId = randomUUID();

    const unitVal = itemData.unit_number || itemData.unitNo || itemData.unitNumber || itemData.name || '';
    const areaVal = itemData.area_sq_ft || itemData.area || itemData.area_sqft || '';
    const normalizedData = {
      ...itemData,
      ...(unitVal ? { unit_number: unitVal, unitNo: unitVal, unitNumber: unitVal } : {}),
      ...(areaVal ? { area_sq_ft: areaVal, area: areaVal, area_sqft: areaVal } : {}),
    };

    const { rows } = await connectDB.query(
      `INSERT INTO public.project_inventory (id, project_id, data, created_at) VALUES ($1, $2, $3, NOW()) RETURNING *`,
      [itemId, projectId, JSON.stringify(normalizedData)]
    );

    const inserted = rows[0];
    const parsedData = typeof inserted.data === 'string' ? JSON.parse(inserted.data) : inserted.data;

    // Get project name
    const pRes = await connectDB.query(`SELECT name FROM public.projects WHERE id = $1`, [projectId]).catch(() => ({ rows: [] }));
    const pName = pRes.rows[0]?.name || 'Project';
    const unitNo = parsedData.unit_number || parsedData.unitNo || parsedData.unitNumber || parsedData.name || 'Unit';

    logActivity({
      type: 'unit',
      title: 'Unit added',
      description: `${unitNo} • ${parsedData.type || 'Inventory'} • Status: ${parsedData.status || 'Available'}`,
      userName: req.user?.name || 'Admin',
      action: 'added unit in',
      leadName: pName,
      detail: `${unitNo} • ${parsedData.type || ''}${parsedData.price ? ` • ₹${parsedData.price}` : ''} • ${parsedData.status || 'Available'}`,
    });

    return res.status(201).json({
      success: true,
      data: {
        id: inserted.id,
        ...parsedData,
      },
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

export const updateInventoryItem = async (req, res) => {
  try {
    const { itemId } = req.params;
    const itemData = req.body || {};

    const unitVal = itemData.unit_number || itemData.unitNo || itemData.unitNumber || itemData.name || '';
    const areaVal = itemData.area_sq_ft || itemData.area || itemData.area_sqft || '';
    const normalizedData = {
      ...itemData,
      ...(unitVal ? { unit_number: unitVal, unitNo: unitVal, unitNumber: unitVal } : {}),
      ...(areaVal ? { area_sq_ft: areaVal, area: areaVal, area_sqft: areaVal } : {}),
    };

    const { rows } = await connectDB.query(
      `UPDATE public.project_inventory SET data = $1 WHERE id = $2 RETURNING *`,
      [JSON.stringify(normalizedData), itemId]
    );

    if (!rows.length) return res.status(404).json({ success: false, message: 'Inventory item not found' });
    const updated = rows[0];
    const parsedData = typeof updated.data === 'string' ? JSON.parse(updated.data) : updated.data;
    const unitNo = parsedData.unit_number || parsedData.unitNo || parsedData.unitNumber || parsedData.name || 'Unit';

    logActivity({
      type: 'unit_updated',
      title: 'Unit updated',
      description: `${unitNo} updated`,
      userName: req.user?.name || 'Admin',
      action: 'updated unit in',
      leadName: unitNo,
      detail: `Status: ${parsedData.status || 'Available'}${parsedData.price ? ` • ₹${parsedData.price}` : ''}`,
    });

    return res.status(200).json({
      success: true,
      data: {
        id: updated.id,
        ...parsedData,
      },
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

export const deleteInventoryItem = async (req, res) => {
  try {
    const { itemId } = req.params;
    const invRes = await connectDB.query(`SELECT data FROM public.project_inventory WHERE id = $1`, [itemId]);
    const d = invRes.rows[0]?.data ? (typeof invRes.rows[0].data === 'string' ? JSON.parse(invRes.rows[0].data) : invRes.rows[0].data) : {};
    const unitNo = d.unit_number || d.unitNumber || d.name || 'Unit';

    await connectDB.query(`DELETE FROM public.project_inventory WHERE id = $1`, [itemId]);

    logActivity({
      type: 'unit_deleted',
      title: 'Unit deleted',
      description: `${unitNo} deleted`,
      userName: req.user?.name || 'Admin',
      action: 'deleted unit in',
      leadName: unitNo,
      detail: `${unitNo} removed from inventory`,
    });

    return res.status(200).json({ success: true, message: 'Inventory item deleted successfully' });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

export const linkLeadToInventoryItem = async (req, res) => {
  try {
    const { id: projectId, itemId } = req.params;
    const { leadId, leadName, status } = req.body;

    const invRes = await connectDB.query(`SELECT * FROM public.project_inventory WHERE id = $1`, [itemId]);
    if (!invRes.rows.length) return res.status(404).json({ success: false, message: 'Inventory item not found' });

    let finalStatus = status || 'Booked';
    if (leadId) {
      const leadRes = await connectDB.query(`SELECT stage FROM public.leads WHERE id = $1`, [leadId]).catch(() => ({ rows: [] }));
      const leadStage = leadRes.rows[0]?.stage;
      if (leadStage) {
        if (isSoldStage(leadStage)) {
          finalStatus = 'Sold';
        } else if (isBookingStage(leadStage)) {
          finalStatus = 'Booked';
        }
      }
    }

    const existingData = typeof invRes.rows[0].data === 'string' ? JSON.parse(invRes.rows[0].data) : invRes.rows[0].data;
    const updatedData = {
      ...existingData,
      lead_id: leadId,
      leadName: leadName,
      buyer: leadName,
      status: finalStatus,
    };

    const { rows } = await connectDB.query(
      `UPDATE public.project_inventory SET data = $1 WHERE id = $2 RETURNING *`,
      [JSON.stringify(updatedData), itemId]
    );

    // Also update lead's project_id
    if (leadId) {
      await connectDB.query(`UPDATE public.leads SET project_id = $1 WHERE id = $2`, [String(projectId), leadId]).catch(() => {});
    }

    const updated = rows[0];
    const parsedData = typeof updated.data === 'string' ? JSON.parse(updated.data) : updated.data;
    const unitNo = parsedData.unit_number || parsedData.unitNumber || 'Unit';

    logActivity({
      type: 'unit',
      title: 'Unit booked',
      description: `${unitNo} booked for ${leadName || 'Lead'} • Status: ${status || 'Booked'}`,
      userName: req.user?.name || 'Admin',
      action: 'booked unit for',
      leadName: leadName || 'Lead',
      leadId: leadId ? String(leadId) : null,
      detail: `${unitNo} linked • Status: ${status || 'Booked'}`,
    });

    return res.status(200).json({
      success: true,
      data: {
        id: updated.id,
        ...parsedData,
      },
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

// ── Project Tasks CRUD ──

export const getProjectTasks = async (req, res) => {
  try {
    const projectId = req.params.id || req.params.projectId;
    const { rows } = await connectDB.query(`SELECT * FROM public.project_tasks WHERE project_id = $1 ORDER BY id DESC`, [projectId]);
    return res.status(200).json({ success: true, count: rows.length, data: rows });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

export const createProjectTask = async (req, res) => {
  try {
    const projectId = req.params.id || req.params.projectId;
    const { title, status = 'To Do', priority = 'Medium', assigned_to = '', due_date = null } = req.body;
    if (!title || !title.trim()) {
      return res.status(400).json({ success: false, message: 'Task title is required' });
    }

    const { rows } = await connectDB.query(
      `INSERT INTO public.project_tasks (project_id, title, status, priority, assigned_to, due_date)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [projectId, title.trim(), status, priority, assigned_to || null, due_date || null]
    );

    const taskRow = rows[0];

    // Get project name
    const pRes = await connectDB.query(`SELECT name FROM public.projects WHERE id = $1`, [projectId]).catch(() => ({ rows: [] }));
    const pName = pRes.rows[0]?.name || 'Project';

    logActivity({
      type: 'task',
      title: 'Task created',
      description: `${title.trim()} • Assigned to: ${assigned_to || 'Team'}`,
      userName: assigned_to || req.user?.name || 'Admin',
      action: 'created task for',
      leadName: pName,
      detail: `${title.trim()} • Priority: ${priority}${due_date ? ` • Due: ${due_date}` : ''}`,
    });

    return res.status(201).json({ success: true, data: taskRow });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

export const updateProjectTask = async (req, res) => {
  try {
    const { taskId } = req.params;
    const { title, status, priority, assigned_to, due_date } = req.body;

    const { rows } = await connectDB.query(
      `UPDATE public.project_tasks SET
        title = COALESCE($1, title),
        status = COALESCE($2, status),
        priority = COALESCE($3, priority),
        assigned_to = COALESCE($4, assigned_to),
        due_date = COALESCE($5, due_date)
       WHERE id = $6 RETURNING *`,
      [title, status, priority, assigned_to, due_date, taskId]
    );

    if (!rows.length) return res.status(404).json({ success: false, message: 'Task not found' });
    const updated = rows[0];

    if (status === 'Completed' || status === 'Done') {
      logActivity({
        type: 'task',
        title: 'Task completed',
        description: `Completed task "${updated.title}"`,
        userName: updated.assigned_to || req.user?.name || 'Admin',
        action: 'completed task',
        leadName: updated.title,
        detail: `Task "${updated.title}" marked as Completed`,
      });
    }

    return res.status(200).json({ success: true, data: updated });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

export const deleteProjectTask = async (req, res) => {
  try {
    const { taskId } = req.params;
    const tRes = await connectDB.query(`SELECT title FROM public.project_tasks WHERE id = $1`, [taskId]);
    const taskTitle = tRes.rows[0]?.title || 'Task';

    await connectDB.query(`DELETE FROM public.project_tasks WHERE id = $1`, [taskId]);

    logActivity({
      type: 'task_deleted',
      title: 'Task deleted',
      description: `Task "${taskTitle}" was deleted`,
      userName: req.user?.name || 'Admin',
      action: 'deleted task for',
      leadName: taskTitle,
      detail: `Task "${taskTitle}" removed`,
    });

    return res.status(200).json({ success: true, message: 'Task deleted successfully' });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

// ── Project Documents CRUD ──

export const getProjectDocuments = async (req, res) => {
  try {
    const { id: projectId } = req.params;
    const { rows } = await connectDB.query(`SELECT documents FROM public.projects WHERE id = $1`, [projectId]);
    if (!rows.length) return res.status(404).json({ success: false, message: 'Project not found' });
    const docs = typeof rows[0].documents === 'string' ? JSON.parse(rows[0].documents) : (rows[0].documents || []);
    return res.status(200).json({ success: true, data: docs });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

export const addProjectDocument = async (req, res) => {
  try {
    const { id: projectId } = req.params;
    const { name, type = 'PDF', size = '1.0 MB', url = '', uploadedBy = 'Admin' } = req.body;
    if (!name || !name.trim()) return res.status(400).json({ success: false, message: 'Document name is required' });

    const { rows } = await connectDB.query(`SELECT name, documents FROM public.projects WHERE id = $1`, [projectId]);
    if (!rows.length) return res.status(404).json({ success: false, message: 'Project not found' });

    const pName = rows[0]?.name || 'Project';
    const currentDocs = typeof rows[0].documents === 'string' ? JSON.parse(rows[0].documents) : (rows[0].documents || []);
    const newDoc = {
      id: randomUUID(),
      name: name.trim(),
      type: (type || 'PDF').toUpperCase(),
      size: size || '1.2 MB',
      url: url || '',
      uploaded: new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }),
      uploadedBy,
    };

    const updatedDocs = [newDoc, ...currentDocs];
    await connectDB.query(`UPDATE public.projects SET documents = $1 WHERE id = $2`, [JSON.stringify(updatedDocs), projectId]);

    logActivity({
      type: 'note',
      title: 'Document uploaded',
      description: `${name.trim()} (${type}, ${size})`,
      userName: uploadedBy || 'Admin',
      action: 'uploaded document for',
      leadName: pName,
      detail: `${name.trim()} • ${type} • ${size}`,
    });

    return res.status(201).json({ success: true, data: newDoc, allDocuments: updatedDocs });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

export const deleteProjectDocument = async (req, res) => {
  try {
    const { id: projectId, docId } = req.params;
    const { rows } = await connectDB.query(`SELECT documents FROM public.projects WHERE id = $1`, [projectId]);
    if (!rows.length) return res.status(404).json({ success: false, message: 'Project not found' });

    const currentDocs = typeof rows[0].documents === 'string' ? JSON.parse(rows[0].documents) : (rows[0].documents || []);
    const updatedDocs = currentDocs.filter((d) => d.id !== docId && d.name !== docId);

    await connectDB.query(`UPDATE public.projects SET documents = $1 WHERE id = $2`, [JSON.stringify(updatedDocs), projectId]);
    return res.status(200).json({ success: true, message: 'Document removed', data: updatedDocs });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

// ── Lead Linking ──

export const linkLeadToProject = async (req, res) => {
  try {
    const { id: projectId } = req.params;
    const { leadId } = req.body;
    if (!leadId) return res.status(400).json({ success: false, message: 'leadId is required' });

    await connectDB.query(`UPDATE public.leads SET project_id = $1 WHERE id = $2`, [String(projectId), leadId]);
    return res.status(200).json({ success: true, message: 'Lead linked to project successfully' });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

export const unlinkLeadFromProject = async (req, res) => {
  try {
    const { leadId } = req.params;
    await connectDB.query(`UPDATE public.leads SET project_id = NULL WHERE id = $1`, [leadId]);
    return res.status(200).json({ success: true, message: 'Lead unlinked from project' });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

// ── Selling Types Settings ──

export const getSellingTypes = async (req, res) => {
  try {
    const { rows } = await connectDB.query(`SELECT * FROM public.selling_types ORDER BY created_at ASC`);
    if (rows.length === 0) {
      const defaultSellingTypes = [
        {
          id: "11111111-1111-4111-a111-111111111111", name: "Residential Property", color: "indigo",
          inventory_field_ids: ["aaaaaaaa-1111-4aaa-aaaa-111111111111", "aaaaaaaa-2222-4aaa-aaaa-222222222222", "aaaaaaaa-3333-4aaa-aaaa-333333333333", "aaaaaaaa-4444-4aaa-aaaa-444444444444", "aaaaaaaa-5555-4aaa-aaaa-555555555555", "aaaaaaaa-6666-4aaa-aaaa-666666666666", "aaaaaaaa-7777-4aaa-aaaa-777777777777"],
          track_inventory: true, item_label: "Unit", identifier_field: "Unit Number",
          available_status: "Available", sold_status: "Sold", progress_label: "Units sold",
        },
        {
          id: "22222222-2222-4222-a222-222222222222", name: "Commercial Property", color: "amber",
          inventory_field_ids: ["aaaaaaaa-1111-4aaa-aaaa-111111111111", "aaaaaaaa-2222-4aaa-aaaa-222222222222", "aaaaaaaa-5555-4aaa-aaaa-555555555555", "aaaaaaaa-6666-4aaa-aaaa-666666666666"],
          track_inventory: true, item_label: "Unit", identifier_field: "Unit Number",
          available_status: "Available", sold_status: "Sold", progress_label: "Units sold",
        },
        {
          id: "33333333-3333-4333-a333-333333333333", name: "Plot / Land", color: "green",
          inventory_field_ids: ["aaaaaaaa-1111-4aaa-aaaa-111111111111", "aaaaaaaa-4444-4aaa-aaaa-444444444444", "aaaaaaaa-5555-4aaa-aaaa-555555555555", "aaaaaaaa-6666-4aaa-aaaa-666666666666"],
          track_inventory: true, item_label: "Plot", identifier_field: "Unit Number",
          available_status: "Available", sold_status: "Sold", progress_label: "Plots sold",
        },
      ];
      for (const st of defaultSellingTypes) {
        await connectDB.query(
          `INSERT INTO public.selling_types (id, name, color, inventory_field_ids, track_inventory, item_label, identifier_field, available_status, sold_status, progress_label)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
           ON CONFLICT (id) DO NOTHING`,
          [st.id, st.name, st.color, JSON.stringify(st.inventory_field_ids), st.track_inventory, st.item_label, st.identifier_field, st.available_status, st.sold_status, st.progress_label]
        ).catch(() => {});
      }
      const reQuery = await connectDB.query(`SELECT * FROM public.selling_types ORDER BY created_at ASC`).catch(() => ({ rows: [] }));
      const returnedRows = reQuery.rows.length > 0 ? reQuery.rows : defaultSellingTypes;
      const types = returnedRows.map((r) => ({
        id: r.id,
        name: r.name,
        color: r.color || 'indigo',
        inventoryFieldIds: typeof r.inventory_field_ids === 'string' ? JSON.parse(r.inventory_field_ids) : (r.inventory_field_ids || []),
        trackInventory: r.track_inventory !== false,
        itemLabel: r.item_label || 'Unit',
        identifierField: r.identifier_field || 'Unit Number',
        availableStatus: r.available_status || 'Available',
        soldStatus: r.sold_status || 'Sold',
        progressLabel: r.progress_label || 'Units sold',
      }));
      return res.status(200).json({ success: true, count: types.length, data: types });
    }

    const types = rows.map((r) => ({
      id: r.id,
      name: r.name,
      color: r.color || 'indigo',
      inventoryFieldIds: typeof r.inventory_field_ids === 'string' ? JSON.parse(r.inventory_field_ids) : (r.inventory_field_ids || []),
      trackInventory: r.track_inventory !== false,
      itemLabel: r.item_label || 'Unit',
      identifierField: r.identifier_field || 'Unit Number',
      availableStatus: r.available_status || 'Available',
      soldStatus: r.sold_status || 'Sold',
      progressLabel: r.progress_label || 'Units sold',
    }));
    return res.status(200).json({ success: true, count: types.length, data: types });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

export const saveSellingTypes = async (req, res) => {
  try {
    const types = req.body;
    const items = Array.isArray(types) ? types : [types];

    if (Array.isArray(types)) {
      const ids = items.map((st) => st.id).filter(Boolean);
      if (ids.length > 0) {
        await connectDB.query(`DELETE FROM public.selling_types WHERE id NOT IN (${ids.map((_, i) => `$${i + 1}`).join(', ')})`, ids);
      } else {
        await connectDB.query(`DELETE FROM public.selling_types`);
      }
    }

    for (const st of items) {
      const id = isUUID(st.id) ? st.id : randomUUID();
      await connectDB.query(
        `INSERT INTO public.selling_types (id, name, color, inventory_field_ids, track_inventory, item_label, identifier_field, available_status, sold_status, progress_label)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
         ON CONFLICT (id) DO UPDATE SET
          name = EXCLUDED.name,
          color = EXCLUDED.color,
          inventory_field_ids = EXCLUDED.inventory_field_ids,
          track_inventory = EXCLUDED.track_inventory,
          item_label = EXCLUDED.item_label,
          identifier_field = EXCLUDED.identifier_field,
          available_status = EXCLUDED.available_status,
          sold_status = EXCLUDED.sold_status,
          progress_label = EXCLUDED.progress_label`,
        [
          id,
          st.name,
          st.color || 'indigo',
          JSON.stringify(st.inventoryFieldIds || []),
          st.trackInventory !== false,
          st.itemLabel || 'Unit',
          st.identifierField || 'Unit Number',
          st.availableStatus || 'Available',
          st.soldStatus || 'Sold',
          st.progressLabel || 'Units sold',
        ]
      );
    }

    return await getSellingTypes(req, res);
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

export const deleteSellingType = async (req, res) => {
  try {
    const { id } = req.params;
    await connectDB.query(`DELETE FROM public.selling_types WHERE id = $1`, [id]);
    return res.status(200).json({ success: true, message: 'Selling type deleted successfully' });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

// ── Inventory Fields Settings ──

export const getInventoryFields = async (req, res) => {
  try {
    const { rows } = await connectDB.query(`SELECT * FROM public.inventory_fields ORDER BY sort_order ASC, id ASC`);
    if (rows.length === 0) {
      const defaultInventoryFields = [
        { id: "aaaaaaaa-1111-4aaa-aaaa-111111111111", label: "Unit Number", field_key: "unitNo", type: "Text Input", required: true, show_in_list: true, show_in_form: true, active: true, options: [], sort_order: 1, placeholder: "e.g. A-101" },
        { id: "aaaaaaaa-2222-4aaa-aaaa-222222222222", label: "Type", field_key: "type", type: "Dropdown", required: true, show_in_list: true, show_in_form: true, active: true, options: ["2BHK", "3BHK", "Villa", "Plot", "Commercial"], sort_order: 2, placeholder: "" },
        { id: "aaaaaaaa-3333-4aaa-aaaa-333333333333", label: "Floor", field_key: "floor", type: "Number Input", required: false, show_in_list: false, show_in_form: true, active: true, options: [], sort_order: 3, placeholder: "e.g. 1" },
        { id: "aaaaaaaa-4444-4aaa-aaaa-444444444444", label: "Area (sqft)", field_key: "area", type: "Number Input", required: false, show_in_list: true, show_in_form: true, active: true, options: [], sort_order: 4, placeholder: "e.g. 950" },
        { id: "aaaaaaaa-5555-4aaa-aaaa-555555555555", label: "Price", field_key: "price", type: "Currency", required: true, show_in_list: true, show_in_form: true, active: true, options: [], sort_order: 5, placeholder: "e.g. 1.8 Cr" },
        { id: "aaaaaaaa-6666-4aaa-aaaa-666666666666", label: "Status", field_key: "status", type: "Dropdown", required: true, show_in_list: true, show_in_form: true, active: true, options: ["Available", "Booked", "Sold", "On Hold"], sort_order: 6, placeholder: "" },
        { id: "aaaaaaaa-7777-4aaa-aaaa-777777777777", label: "Buyer Name", field_key: "buyer", type: "Text Input", required: false, show_in_list: false, show_in_form: true, active: true, options: [], sort_order: 7, placeholder: "e.g. Vikram Mehta" },
      ];
      for (const f of defaultInventoryFields) {
        await connectDB.query(
          `INSERT INTO public.inventory_fields (id, label, field_key, type, required, show_in_list, show_in_form, active, options, sort_order, placeholder, created_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, NOW(), NOW())
           ON CONFLICT (id) DO NOTHING`,
          [f.id, f.label, f.field_key, f.type, f.required, f.show_in_list, f.show_in_form, f.active, JSON.stringify(f.options), f.sort_order, f.placeholder]
        ).catch(() => {});
      }
      const reQuery = await connectDB.query(`SELECT * FROM public.inventory_fields ORDER BY sort_order ASC, id ASC`).catch(() => ({ rows: [] }));
      const returnedRows = reQuery.rows.length > 0 ? reQuery.rows : defaultInventoryFields;
      const fields = returnedRows.map((r) => ({
        id: r.id,
        label: r.label,
        fieldKey: r.field_key || r.fieldKey,
        type: r.type,
        required: r.required,
        showInList: r.show_in_list !== false && r.showInList !== false,
        showInForm: r.show_in_form !== false && r.showInForm !== false,
        active: r.active !== false,
        options: typeof r.options === 'string' ? JSON.parse(r.options) : (r.options || []),
        order: r.sort_order ?? r.order ?? 1,
        placeholder: r.placeholder || '',
      }));
      return res.status(200).json({ success: true, count: fields.length, data: fields });
    }

    const fields = rows.map((r) => ({
      id: r.id,
      label: r.label,
      fieldKey: r.field_key,
      type: r.type,
      required: r.required,
      showInList: r.show_in_list,
      showInForm: r.show_in_form,
      active: r.active,
      options: typeof r.options === 'string' ? JSON.parse(r.options) : (r.options || []),
      order: r.sort_order ?? 1,
      placeholder: r.placeholder || '',
    }));
    return res.status(200).json({ success: true, count: fields.length, data: fields });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

export const saveInventoryFields = async (req, res) => {
  try {
    const fields = req.body;
    const items = Array.isArray(fields) ? fields : (fields?.fields || [fields]);

    const client = await connectDB.connect();
    try {
      await client.query('BEGIN');
      await client.query(`TRUNCATE TABLE public.inventory_fields RESTART IDENTITY CASCADE`);

      const seenKeys = new Set();
      let orderIndex = 1;

      for (let i = 0; i < items.length; i++) {
        const f = items[i];
        if (!f || !f.label?.trim()) continue;
        const normalizedLabel = f.label.trim();
        const fieldKey = f.fieldKey || normalizedLabel.toLowerCase().replace(/[^a-z0-9]/g, '_').replace(/_{2,}/g, '_').replace(/^_|_$/g, '');

        if (seenKeys.has(fieldKey.toLowerCase())) {
          continue;
        }
        seenKeys.add(fieldKey.toLowerCase());

        const sortOrder = orderIndex;
        orderIndex++;
        const fieldId = isUUID(f.id) ? f.id : randomUUID();

        await client.query(
          `INSERT INTO public.inventory_fields (id, label, field_key, type, required, show_in_list, show_in_form, active, options, sort_order, placeholder, created_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, NOW(), NOW())`,
          [
            fieldId,
            normalizedLabel,
            fieldKey,
            f.type || 'Text Input',
            f.required ?? false,
            f.showInList !== false,
            f.showInForm !== false,
            f.active !== false,
            JSON.stringify(f.options || []),
            sortOrder,
            f.placeholder || '',
          ]
        );
      }

      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }

    const { rows } = await connectDB.query(`SELECT * FROM public.inventory_fields ORDER BY sort_order ASC, id ASC`);
    const savedFields = rows.map((r) => ({
      id: r.id,
      label: r.label,
      fieldKey: r.field_key,
      type: r.type,
      required: r.required,
      showInList: r.show_in_list,
      showInForm: r.show_in_form,
      active: r.active,
      options: typeof r.options === 'string' ? JSON.parse(r.options) : (r.options || []),
      order: r.sort_order ?? 1,
      placeholder: r.placeholder || '',
    }));

    return res.status(200).json({ success: true, count: savedFields.length, data: savedFields });
  } catch (err) {
    console.error("saveInventoryFields error:", err);
    return res.status(500).json({ success: false, message: err.message });
  }
};

export const deleteInventoryField = async (req, res) => {
  try {
    const { id } = req.params;
    if (!id || String(id).startsWith('tmp-') || String(id).startsWith('field-')) {
      return res.status(200).json({ success: true, message: 'Inventory field deleted successfully' });
    }
    await connectDB.query(`DELETE FROM public.inventory_fields WHERE id = $1 OR field_key = $1`, [String(id)]);
    return res.status(200).json({ success: true, message: 'Inventory field deleted successfully' });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};
