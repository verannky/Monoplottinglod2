// server.js
const express = require("express");
const cors = require("cors");
const multer = require("multer");
const fs = require("fs");
const path = require("path");

const app = express();
const PORT = 5000;

// Middleware
app.use(cors());
app.use(express.json());

// Static file serving
app.use("/uploaded", express.static(path.join(__dirname, "uploaded")));             // Uploaded images
app.use("/annotations", express.static(path.join(__dirname, "annotations")));       // Annotation .geojson files
app.use("/placed", express.static(path.join(__dirname, "placed_windows")));         // Final placed window polygons

// Routes
const uploadRouter = require("./uploadImage");
app.use("/api", uploadRouter);

const annotationRouter = require("./routes/annotation");
app.use("/api", annotationRouter);

const placeWindowRouter = require("./routes/placed");
app.use("/api", placeWindowRouter); // ✅ use /api consistently

// Start server
app.listen(PORT, () => {
  console.log(`✅ Server running at http://localhost:${PORT}`);
});
