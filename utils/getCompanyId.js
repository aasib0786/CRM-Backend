export const getCompanyId = (req) => {
  if (!req.company_id) {
    throw new Error("Company context missing");
  }
  return req.company_id;
};