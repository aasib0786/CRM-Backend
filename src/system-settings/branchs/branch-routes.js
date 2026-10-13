
import { Router } from "express";

import {
  createBranch,
  getBranches,
  getBranchById,
  updateBranch,
  deleteBranch,
  toggleBranchStatus,
  getBranchStats,
  getBranchUsers,
} from "./branch-controller.js";

import { verifyToken } from "../../../middlewares/verifyToken.middleware.js";

const router = Router();

/* Static paths before parameterised ones. */
router.get("/stats", verifyToken, getBranchStats);
router.get("/get-all", verifyToken, getBranches);

router.post("/create", verifyToken, createBranch);

router.get("/get-by-id/:id", verifyToken, getBranchById);
router.get("/users/:id", verifyToken, getBranchUsers);

router.put("/update/:id", verifyToken, updateBranch);
router.patch("/update/:id", verifyToken, updateBranch);
router.patch("/toggle-status/:id", verifyToken, toggleBranchStatus);

router.delete("/delete/:id", verifyToken, deleteBranch);

export default router;