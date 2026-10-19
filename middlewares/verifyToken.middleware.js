import jwt from "jsonwebtoken";
import connectDB from "../src/pool.js";

export const verifyToken = async (req, res, next) => {
  try {
    let token;

    // ✅ 1. Authorization header
    const authHeader = req.headers.authorization;
    if (authHeader?.startsWith("Bearer ")) {
      token = authHeader.split(" ")[1]?.trim();
    }

    // ✅ 2. Fallback to cookie
    if (!token && req.cookies?.token) {
      token = req.cookies.token?.trim();
    }

    // ❌ No token
    if (!token) {
      return res.status(401).json({
        success: false,
        message: "Unauthorized — no token provided",
      });
    }

    // ✅ Strip surrounding quotes if token was double-stringified
    if (token.startsWith('"') && token.endsWith('"')) {
      token = token.slice(1, -1);
    }

    // ✅ Basic JWT format check before verifying
    if (token.split('.').length !== 3) {
      return res.status(401).json({
        success: false,
        message: "Invalid token format",
      });
    }

    // ✅ Verify with configured or fallback JWT Secret
    const secret = process.env.JWT_SECRET_KEY || process.env.JWT_SECRET || 'abcd1234sjkynqoinkerhkaw';
    const decoded = jwt.verify(token, secret);

    req.user = decoded;
    req.role = decoded.role;
    req.company_id = decoded.company_id || decoded.companyId;

    // ✅ Multi-Tenant Safeguard: if token lacks company_id, resolve directly from public.users
    if (!req.company_id && (decoded.id || decoded.email)) {
      try {
        const uRes = await connectDB.query(
          "SELECT company_id, role FROM public.users WHERE id::text = $1 OR LOWER(email) = LOWER($2) LIMIT 1",
          [String(decoded.id || ''), String(decoded.email || '').trim()]
        );
        if (uRes.rows.length > 0 && uRes.rows[0].company_id) {
          req.company_id = uRes.rows[0].company_id;
          req.user.company_id = uRes.rows[0].company_id;
          req.user.companyId = uRes.rows[0].company_id;
          if (!req.role && uRes.rows[0].role) req.role = uRes.rows[0].role;
        }
      } catch (dbErr) {
        // silent fallback
      }
    }

    next();

  } catch (err) {
    console.error("TOKEN ERROR =>", err.name, err.message);

    const messages = {
      JsonWebTokenError: "Invalid token",
      TokenExpiredError: "Token expired — please login again",
      NotBeforeError: "Token not yet valid",
    };

    return res.status(401).json({
      success: false,
      message: messages[err.name] ?? "Authentication failed",
    });
  }
};