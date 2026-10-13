import connectDB from '../pool.js';

export const getNotifications = async (req, res) => {
  try {
    const result = await connectDB.query(`
      SELECT 
        n.*,
        (n.scheduled_at <= NOW()) AS is_due
      FROM public.notifications n
      ORDER BY 
        CASE WHEN n.scheduled_at <= NOW() THEN 0 ELSE 1 END,
        n.scheduled_at DESC,
        n.created_at DESC
      LIMIT 50
    `);

    const unreadResult = await connectDB.query(`
      SELECT COUNT(*)::int AS unread_count
      FROM public.notifications
      WHERE read = false AND scheduled_at <= NOW()
    `);

    const unreadCount = unreadResult.rows[0]?.unread_count || 0;

    const items = result.rows.map((row) => {
      let timeText = 'Just now';
      if (row.scheduled_at) {
        const d = new Date(row.scheduled_at);
        const now = new Date();
        const diffMs = now.getTime() - d.getTime();
        const diffMins = Math.floor(diffMs / 60000);
        if (diffMs < 0) {
          // Future scheduled
          timeText = `Scheduled: ${d.toLocaleDateString('en-IN', { month: 'short', day: 'numeric' })} at ${d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}`;
        } else if (diffMins < 1) {
          timeText = 'Just now';
        } else if (diffMins < 60) {
          timeText = `${diffMins} min${diffMins > 1 ? 's' : ''} ago`;
        } else if (diffMins < 1440) {
          const hrs = Math.floor(diffMins / 60);
          timeText = `${hrs} hr${hrs > 1 ? 's' : ''} ago`;
        } else {
          timeText = d.toLocaleDateString('en-IN', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
        }
      }

      return {
        id: row.id,
        type: row.type || 'alert',
        title: row.title,
        description: row.description || '',
        leadId: row.lead_id,
        leadName: row.lead_name,
        activityId: row.activity_id,
        scheduledAt: row.scheduled_at,
        isDue: row.is_due,
        time: timeText,
        read: row.read,
        createdAt: row.created_at,
      };
    });

    return res.status(200).json({
      success: true,
      unreadCount,
      data: items,
      items,
    });
  } catch (error) {
    console.error('getNotifications error:', error.message);
    return res.status(500).json({ success: false, message: 'Failed to fetch notifications' });
  }
};

export const markNotificationRead = async (req, res) => {
  try {
    const { id } = req.params;
    await connectDB.query(`UPDATE public.notifications SET read = true WHERE id = $1`, [id]);
    return res.status(200).json({ success: true, message: 'Marked as read' });
  } catch (error) {
    console.error('markNotificationRead error:', error.message);
    return res.status(500).json({ success: false, message: 'Failed to update notification' });
  }
};

export const markAllNotificationsRead = async (req, res) => {
  try {
    await connectDB.query(`UPDATE public.notifications SET read = true WHERE scheduled_at <= NOW()`);
    return res.status(200).json({ success: true, message: 'All marked as read' });
  } catch (error) {
    console.error('markAllNotificationsRead error:', error.message);
    return res.status(500).json({ success: false, message: 'Failed to mark all as read' });
  }
};

export const deleteNotification = async (req, res) => {
  try {
    const { id } = req.params;
    await connectDB.query(`DELETE FROM public.notifications WHERE id = $1`, [id]);
    return res.status(200).json({ success: true, message: 'Deleted notification' });
  } catch (error) {
    console.error('deleteNotification error:', error.message);
    return res.status(500).json({ success: false, message: 'Failed to delete notification' });
  }
};
