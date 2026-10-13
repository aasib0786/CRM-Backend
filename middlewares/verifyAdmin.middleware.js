import jwt from "jsonwebtoken";

export const verifyAdmin = (requiredRole) => {
  return (req, res, next) => {
    try {
      const token = req.cookies?.token;

      if (!token && !req.user) {
        return res.status(401).json({ message: "Unauthorized you are not logged In" });
      }

      const decoded = req.user || jwt.verify(token, process.env.JWT_SECRET_KEY);
      if (!decoded.role) {
        next();
        return;
      }
      const userRole = String(decoded.role || "").trim().toUpperCase();
      const expectedRole = String(requiredRole || "").trim().toUpperCase();

      if (expectedRole && userRole !== expectedRole && userRole !== "SUPER_ADMIN") {
        return res.status(403).json({
          message: "Access Denied — This feature is restricted to authorized users only.",
        });
      }

      next();
    } catch (error) {
      console.log("Verify admin error", error);
      return res.status(500).json({ message: "Unauthorized Invalid token" });
    }
  };
};
