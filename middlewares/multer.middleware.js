import multer from "multer";
import path from "path";
import fs from "fs";

// ✅ Helper to create folder if not exists
const ensureDir = (dir) => {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
};

// ✅ MAIN STORAGE (dynamic based on route)
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    console.log("file==>>>>>>", file);

    // 🔥 Decide folder dynamically
    let folder = "others";

    if (file.fieldname === "logo") {
      folder = "company";
    } else if (file.fieldname === "profile_image") {
      folder = "profile";
    }

    const uploadPath = path.join(process.cwd(), "uploads", folder);

    // ✅ Ensure folder exists
    ensureDir(uploadPath);

    cb(null, uploadPath);
  },

  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
    const ext = path.extname(file.originalname);

    cb(null, `${file.fieldname}-${uniqueSuffix}${ext}`);
  },
});

// ✅ SECOND STORAGE (if you still want original names)
const ImageStorage = multer.diskStorage({
  destination: function (req, file, cb) {
    const uploadPath = path.join(process.cwd(), "uploads", "images");

    ensureDir(uploadPath);

    cb(null, uploadPath);
  },

  filename: function (req, file, cb) {
    cb(null, file.originalname);
  },
});

// ✅ Upload middlewares
export const upload = multer({
  storage: storage,
  limits: { fileSize: 2 * 1024 * 1024 },
});

export const uploadImages = multer({
  storage: ImageStorage,
  limits: { fileSize: 2 * 1024 * 1024 },
});
