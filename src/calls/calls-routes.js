import express from 'express';
import jwt from 'jsonwebtoken';
import {
  getCalls,
  getCallStats,
  createCall,
  updateCall,
  deleteCall,
  getScheduledCalls,
  createScheduledCall,
  deleteScheduledCall,
} from './calls-controller.js';

const router = express.Router();

const optionalAuth = (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    let token = null;
    if (authHeader?.startsWith("Bearer ")) {
      token = authHeader.split(" ")[1]?.trim();
    } else if (req.cookies?.token) {
      token = req.cookies.token;
    } else if (req.cookies?.accessToken) {
      token = req.cookies.accessToken;
    }
    if (token && token !== "null" && token !== "undefined") {
      const decoded = jwt.decode(token);
      if (decoded) req.user = decoded;
    }
  } catch (e) {}
  next();
};

router.use(optionalAuth);

// Stats & Scheduled routes (placed before /:id)
router.get('/stats', getCallStats);
router.get('/scheduled', getScheduledCalls);
router.post('/scheduled', createScheduledCall);
router.delete('/scheduled/:id', deleteScheduledCall);

// Core Call Logs routes
router.get('/', getCalls);
router.post('/', createCall);
router.put('/:id', updateCall);
router.delete('/:id', deleteCall);

export default router;
