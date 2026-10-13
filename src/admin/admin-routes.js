// import { Router } from "express";
// import {
//   //   sendOtpToUser,

//   login,
//   logout,
//   GetSingleUser,
//   ForgotPassword,
//   ResetPassword,
//   verifyLoggedIn,
//   //updateProfile,
//   createUserByAdmin,
//   getAllUsers,
//   getUserById,
//   updateUserByAdmin,
//   deleteUserByAdmin,
//   updateUserPermissionsByAdmin,
//   toggleUserActiveByAdmin,
//   searchAndFilterUsers,
//   getAllUsersForSuperAdmin,
//   singUp
// } from "./admin-controller.js";
// import { verifyToken } from "../../middlewares/verifyToken.middleware.js";
// import { multerErrorHandler } from "../../middlewares/multerErrorHadler.middleware.js";
// import { upload } from "../../middlewares/multer.middleware.js";

// const router = Router();

// // router.post("/send-otp-to-user", sendOtpToUser);

// router.post("/login", login);
// router.post("/sing-up", singUp);
// router.post("/logout", verifyToken, logout);
// router.get("/get-single-user", verifyToken, GetSingleUser);
// router.post("/forgot-password", ForgotPassword);
// router.post("/reset-password/:token", ResetPassword);
// router.get("/me", verifyToken, verifyLoggedIn);
// //router.put("/update-profile", verifyToken, upload.single("image"), multerErrorHandler, updateProfile);
// //
// router.post("/company-user/create", verifyToken, createUserByAdmin);

// router.get("/company-user/all", verifyToken, getAllUsers);

// // router.get("/company-user/:id", verifyToken, getUserById);

// // router.patch("/company-user/update/:id", verifyToken, updateUserByAdmin);

// router.delete("/company-user/delete/:id", verifyToken, deleteUserByAdmin);

// // router.post("/company-user/search-filter", verifyToken, searchAndFilterUsers);

// // router.get("/company-users/all", verifyToken, getAllUsersForSuperAdmin);

// // REST aliases for unified users contract

// // router.patch("/company-user/:id/permissions", verifyToken, updateUserPermissionsByAdmin);
// // router.patch("/company-user/:id/active", verifyToken, toggleUserActiveByAdmin);

// export default router;



// src/auth/admin-routes.js
import { Router } from 'express';
import {
  login,
  logout,
  singUp,
  GetSingleUser,
  ForgotPassword,
  ResetPassword,
  verifyLoggedIn,
  createUserByAdmin,
  getAllUsers,
  getUserById,
  updateUserByAdmin,
  deleteUserByAdmin,
  updateUserPermissionsByAdmin,
  toggleUserActiveByAdmin,
  searchAndFilterUsers,
  getAllUsersForSuperAdmin,
} from './admin-controller.js';
import { verifyToken } from '../../middlewares/verifyToken.middleware.js';

const router = Router();

// ── Public ────────────────────────────────────────────────────
router.post('/login', login);
router.post('/sing-up', singUp);
router.post('/forgot-password', ForgotPassword);
router.post('/reset-password/:token', ResetPassword);

// ── Auth required ─────────────────────────────────────────────
router.get('/me', verifyToken, verifyLoggedIn);
router.get('/get-single-user', verifyToken, GetSingleUser);
router.post('/logout', verifyToken, logout);

// ── Company user CRUD ─────────────────────────────────────────
router.post('/company-user/create', verifyToken, createUserByAdmin);
router.get('/company-user/all', verifyToken, getAllUsers);
router.get('/company-user/:id', verifyToken, getUserById);
router.patch('/company-user/update/:id', verifyToken, updateUserByAdmin);
router.delete('/company-user/delete/:id', verifyToken, deleteUserByAdmin);

// ── Extra ─────────────────────────────────────────────────────
router.post('/company-user/search-filter', verifyToken, searchAndFilterUsers);
router.patch('/company-user/:id/permissions', verifyToken, updateUserPermissionsByAdmin);
router.patch('/company-user/:id/active', verifyToken, toggleUserActiveByAdmin);

// ── Super admin only ─────────────────────────────────────────
router.get('/company-users/all', verifyToken, getAllUsersForSuperAdmin);

export default router;