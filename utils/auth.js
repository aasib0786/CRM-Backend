import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";

// // 🔐 Hash Password
// export const hashPassword = async (password) => {
//   try {
//     const saltRounds = 10;
//     return await bcrypt.hash(password, saltRounds);
//   } catch (error) {
//     throw new Error("Error hashing password");
//   }
// };

// AFTER — real error propagate karo
export const hashPassword = async (password) => {
  if (!password) throw new Error('Password is required for hashing');
  return bcrypt.hash(password, 10); // no try/catch — let caller handle
};


// 🔍 Compare Password
export const comparePassword = async (password, hashedPassword) => {
  try {
    return await bcrypt.compare(password, hashedPassword);
  } catch (error) {
    throw new Error("Error comparing password");
  }
};


// 🎟️ Generate Access Token
export const generateAccessToken = (user) => {
  return jwt.sign(
    {
      id: user.id,
      email: user.email,
      company_id: user.company_id,
      role: user.role,
    },
    process.env.JWT_SECRET_KEY,
    {
      expiresIn: process.env.ACCESS_TOKEN_EXPIRY || "1d",
    }
  );
};


// 🔄 Generate Refresh Token
export const generateRefreshToken = (user) => {
  return jwt.sign(
    {

      id: user.id,
      email: user.email,
      company_id: user.company_id,
      role: user.role,
    },
    process.env.REFRESH_TOKEN_SECRET,
    {
      expiresIn: process.env.REFRESH_TOKEN_EXPIRY || "7d",
    }
  );
};




// Verifies the Bearer token and attaches { id, companyId, role } to req.user.
// Must match the payload shape signed in authController.js (register/login).
export const authenticate = (req, res, next) => {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;

  if (!token) {
    return res.status(401).json({ success: false, message: 'Authentication token missing' });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = {
      id: decoded.id,
      companyId: decoded.companyId,
      role: decoded.role,
    };
    next();
  } catch (error) {
    return res.status(401).json({ success: false, message: 'Invalid or expired token' });
  }
};

// Usage: requireRole('super_admin', 'admin')
export const requireRole = (...allowedRoles) => (req, res, next) => {

  console.log("permanent==>", req.user, allowedRoles.includes(req.user.role))
  if (!req.user || !allowedRoles.includes(req.user.role)) {
    return res.status(403).json({ success: false, message: 'You do not have permission to perform this action' });
  }
  next();
};

// Mirrors the frontend convention:
//   positions.find(p => p.name.toLowerCase().replace(/\s/g, "_") === role)
// Keep this in sync with any frontend changes to that logic.
export const toRoleSlug = (positionName) => positionName.trim().toLowerCase().replace(/\s+/g, '_');
