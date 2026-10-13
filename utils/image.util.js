import fs from "fs";
import path from "path";
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

 const deleteLocalImage = (imagePath) => {
  const fullPath = path.join(process.cwd(), imagePath);

  fs.unlink(fullPath, (err) => {
    if (err) {
      console.error("Error deleting image:", err);
    } 
  });
};


const IMAGE_DIR = path.join(__dirname, "../public/images"); 
const ALLOWED_EXTS = [".jpg", ".jpeg", ".png", ".webp", ".gif"];

const findImageWithExtension = (baseName) => {
  for (const ext of ALLOWED_EXTS) {
    const fullPath = path.join(IMAGE_DIR, `${baseName}${ext}`);
    if (fs.existsSync(fullPath)) {
      return `${baseName}${ext}`;
    }
  }
  return `${baseName}.jpg`;
};
export { deleteLocalImage, findImageWithExtension };