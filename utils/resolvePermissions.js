

import { SUPER_ADMIN_ROLE,  SUPER_ADMIN_PERMISSIONS, SUPER_ADMIN_ADDITIONAL_CONTROLS,  } from "./permissions.js";

export const resolvePermissions = (user) => {
  if (user.role === SUPER_ADMIN_ROLE) {
    return {
      permissions: SUPER_ADMIN_PERMISSIONS,
      additionalControls: SUPER_ADMIN_ADDITIONAL_CONTROLS,
    };
  }

  return {
    permissions: user.permissions ?? {},
    additionalControls: user.additional_controls ?? {},
  };
};