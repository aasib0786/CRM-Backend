
import { error } from '../utils/respons.js';

let Role = 'SUPER_ADMIN' | 'SUB_ADMIN' | 'END_USER';

/**
 * requireRole('SUPER_ADMIN') — Only allows the specified roles.
 * Usage: router.patch('/company', requireRole('SUPER_ADMIN'), controller)
 */
export const requireRole = (...allowedRoles) => {
  return (req, res, next) => {
    const user = req.user;

    if (!user) {
      return res.status(401).json(error('UNAUTHORIZED', 'Authentication required'));
    }

    if (!allowedRoles.includes(user.role)) {
      return res.status(403).json(
        error(
          'FORBIDDEN',
          `This action requires one of these roles: ${allowedRoles.join(', ')}`,
        ),
      );
    }

    next();
  };
};

export const requirePermission = (permissionKey) => {
  return (req, res, next) => {
    const user = req.user;

    if (!user) {
      return res.status(401).json(error('UNAUTHORIZED', 'Authentication required'));
    }

    // SUPER_ADMIN and SUB_ADMIN bypass permission checks
    if (user.role === 'SUPER_ADMIN' || user.role === 'SUB_ADMIN') {
      return next();
    }

    // END_USER must have the specific permission
    const permissions = (user).permissions || [];
    if (!permissions.includes(permissionKey)) {
      return res.status(403).json(
        error('FORBIDDEN', `You do not have the required permission: ${permissionKey}`),
      );
    }

    next();
  };
};