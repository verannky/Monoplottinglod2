// uploadImage.js
const express = require("express");
const multer = require("multer");
const fs = require("fs");
const path = require("path");

const router = express.Router();

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const buildingId = req.params.buildingId;
    const dir = `uploaded/${buildingId}`;
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    cb(null, `${Date.now()}_${file.originalname}`);
  },
});

const upload = multer({ storage });

router.post("/upload/:buildingId", upload.array("images"), (req, res) => {
  res.json({ message: "Uploaded successfully", files: req.files });
});

router.get("/images/:buildingId", (req, res) => {
  const dir = path.join(__dirname, "uploaded", req.params.buildingId);
  if (!fs.existsSync(dir)) return res.json([]);

  const files = fs.readdirSync(dir).map((name) => ({
    name,
    url: `/uploaded/${req.params.buildingId}/${name}`,
  }));
  res.json(files);
});

// DELETE /api/images/:buildingId/:filename
router.delete("/images/:buildingId/:filename", (req, res) => {
  const { buildingId, filename } = req.params;
  const filePath = path.join(__dirname, "uploaded", buildingId, filename);

  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ message: "File not found" });
  }

  try {
    fs.unlinkSync(filePath);
    res.json({ message: "File deleted" });
  } catch (err) {
    console.error("❌ Error deleting file:", err);
    res.status(500).json({ message: "Error deleting file" });
  }
});


module.exports = router;
