/**
 * InvenPro ERP — Standard API Response Helpers
 * All API responses follow this format (per API Spec doc).
 *
 * Success:          { success: true, data: {...}, message: 'OK' }
 * List:             { success: true, data: [...], total, page, limit }
 * Error:            { success: false, error: 'ERROR_CODE', message: 'Human message' }
 * Validation Error: { success: false, errors: [{ field, message }] }
 */

export const success = (data, message = 'OK') => ({
  success: true,
  data,
  message,
});

export const successList = (
  data,
  total,
  page,
  limit,
  message = 'OK',
) => ({
  success: true,
  data,
  total,
  page,
  limit,
  message,
});

export const error = (code, message) => ({
  success: false,
  error: code,
  message,
});