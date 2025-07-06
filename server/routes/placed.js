// routes/placed.js
const express = require("express");
const fs = require("fs");
const path = require("path");

const router = express.Router();

// Existing POST route
router.post("/placeAnnotationOnBuilding", (req, res) => {
  console.log("📥 Received polygon to place on building");

  const geojson = req.body;
  const feature = geojson?.features?.[0];
  const imageName = feature?.properties?.imageName;
  const buildingId = feature?.properties?.buildingId;

  if (!imageName || !buildingId) {
    return res.status(400).json({ error: "Missing imageName or buildingId in properties." });
  }

  try {
    const baseName = path.parse(imageName).name;
    const buildingFolder = path.join(__dirname, "..", "placed_windows", buildingId);
    const outputPath = path.join(buildingFolder, `${baseName}.geojson`);

    fs.mkdirSync(buildingFolder, { recursive: true });
    fs.writeFileSync(outputPath, JSON.stringify(geojson, null, 2));

    res.json({
      status: "success",
      message: `Annotation saved to ${outputPath}`,
      filePath: `placed/${buildingId}/${baseName}.geojson`,
    });
  } catch (err) {
    console.error("❌ Error saving annotation:", err);
    res.status(500).json({ error: "Failed to save annotation." });
  }
});

// ✅ NEW: GET route to list placed windows for a building
router.get("/placed_windows/:buildingId", (req, res) => {
  const buildingId = req.params.buildingId;
  const folderPath = path.join(__dirname, "..", "placed_windows", buildingId);

  fs.readdir(folderPath, (err, files) => {
    if (err) {
      console.error("❌ Error reading placed_windows folder:", err);
      return res.status(500).json({ error: "Failed to read placed windows folder." });
    }

    const geojsonFiles = files.filter(f => f.endsWith(".geojson"));
    res.json(geojsonFiles); // ✅ return clean array of filenames
  });
});

// ✅ GET individual GeoJSON file content
router.get("/placed_windows/:buildingId/:filename", (req, res) => {
  const { buildingId, filename } = req.params;
  console.log("🔍 Requested:", buildingId, filename); 
  const filePath = path.join(__dirname, "..", "placed_windows", buildingId, filename);

  // Check if file exists first
  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: "GeoJSON file not found." });
  }

  // Read and return the file
  fs.readFile(filePath, 'utf8', (err, data) => {
    if (err) {
      console.error("❌ Error reading GeoJSON:", err);
      return res.status(500).json({ error: "Failed to read GeoJSON file." });
    }
    res.send(data); // Returns the raw GeoJSON content
  });
});

router.put("/placed_windows/:buildingId/:filename", (req, res) => {
  const { buildingId, filename } = req.params;
  const filePath = path.join(__dirname, "..", "placed_windows", buildingId, filename);

  console.log(`📝 PUT Request:`);
  console.log(`➡️  Building ID: ${buildingId}`);
  console.log(`➡️  Filename: ${filename}`);
  console.log(`📄 Full path: ${filePath}`);

  fs.writeFile(filePath, JSON.stringify(req.body, null, 2), (err) => {
    if (err) {
      console.error("❌ Error saving GeoJSON file:", err);
      return res.status(500).json({ error: "Failed to save GeoJSON file" });
    }
    res.json({ success: true });
  });
});

// ✅ DELETE route to remove a placed window GeoJSON file
router.delete("/placed/:buildingId/:filename", (req, res) => {
  const { buildingId, filename } = req.params;

  if (!filename.endsWith(".geojson")) {
    return res.status(400).json({ error: "Invalid file type." });
  }

  const filePath = path.join(__dirname, "..", "placed_windows", buildingId, filename);

  fs.unlink(filePath, (err) => {
    if (err) {
      console.error("❌ Failed to delete file:", err);
      return res.status(500).json({ error: "Failed to delete file." });
    }

    res.json({ status: "success", message: `Deleted ${filename}` });
  });
});


module.exports = router;
