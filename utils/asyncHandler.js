/**
 * asyncHandler
 * Wraps async route handlers to automatically catch errors
 * and forward them to Express global error middleware.
 */

export const asyncHandler = (fn) => {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
};
