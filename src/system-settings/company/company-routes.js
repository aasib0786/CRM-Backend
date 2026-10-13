import express from "express";
import multer from 'multer';

import {
  createCompany,
  getAllCompanies,
  getCompanyById,
  updateCompany,
  deleteCompany
} from "./company-controller.js";
import { verifyToken } from "../../../middlewares/verifyToken.middleware.js";

const router = express.Router();
const upload = multer();

router.use(verifyToken)

router.post("/", upload.none(), createCompany);
router.get("/", getAllCompanies);
router.get("/get", getCompanyById);
router.put("/", updateCompany);
router.delete("/:id", deleteCompany);

export default router;
