
const express = require("express");
const fs = require("fs");
const path = require("path");

const router = express.Router();

// Save annotation
router.post("/annotations/:buildingId/:imageName", (req, res) => {
  const { buildingId, imageName } = req.params;
  const folder = path.join(__dirname, "..", "annotations", buildingId);
  const filepath = path.join(folder, imageName);

  fs.mkdirSync(folder, { recursive: true });
  fs.writeFileSync(filepath, JSON.stringify(req.body, null, 2));

  res.json({ message: "Annotation saved." });
});

// GET route to list annotations for a building
router.get("/annotations/:buildingId", (req, res) => {
  const { buildingId } = req.params;
  const folder = path.join(__dirname, "..", "annotations", buildingId);

  console.log("Looking in folder:", folder); // ⬅️ Add this debug line

  if (!fs.existsSync(folder)) {
    return res.status(404).json({ message: "Folder not found" });  // ⬅️ make it a real 404 with message
  }

  const files = fs.readdirSync(folder).filter(f => f.endsWith(".geojson"));
  return res.json(files);
});

// DELETE annotation
router.delete("/annotations/:buildingId/:filename", (req, res) => {
  const { buildingId, filename } = req.params;
  const filePath = path.join(__dirname, "..", "annotations", buildingId, filename);

  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ message: "Annotation not found." });
  }

  try {
    fs.unlinkSync(filePath);
    res.json({ message: "Annotation deleted successfully." });
  } catch (err) {
    console.error("❌ Error deleting annotation:", err);
    res.status(500).json({ message: "Failed to delete annotation." });
  }
});



module.exports = router;
