import React, { useEffect, useRef, useState } from "react";
import { FaEye } from "react-icons/fa";
import './Imageannotator.css';
import Cesium, {
  Ion,
  IonResource,
  Viewer,
  GeoJsonDataSource,
  Color,
  HeadingPitchRange,
  Cartographic,
  Ellipsoid,
  Cartesian3,
  LabelStyle,
  PolygonHierarchy,
  BoxGeometry,
  GeometryInstance,
  ColorGeometryInstanceAttribute,
  Primitive,
  VertexFormat,
  Matrix4,
  HeadingPitchRoll,
  Transforms,
  VerticalOrigin,
  HeightReference,
  PerInstanceColorAppearance,
  Math as CesiumMath,
} from "cesium";
import { useParams, useNavigate } from "react-router-dom";
import "cesium/Build/Cesium/Widgets/widgets.css";
import ImageAnnotator from "./ImageAnnotator";
import ShowAnnotation from './ShowAnnotation';
import { handlePlace } from "./handlePlace";
import { FaTrash } from "react-icons/fa";
import { FaSyncAlt } from "react-icons/fa";
import { FaInfoCircle } from "react-icons/fa";
import exifr from "exifr";
import useImage from "use-image";

const ZoomBuilding = () => {
  const viewerRef = useRef(null);
  const { uid } = useParams();
  const navigate = useNavigate();
  const [files, setFiles] = useState([]);
  const [images, setImages] = useState([]);
  const [selectedImage, setSelectedImage] = useState(null);
  const [isAnnotating, setIsAnnotating] = useState(false);
  const [annotations, setAnnotations] = useState([]);
  const [showingAnnotation, setShowingAnnotation] = useState(null);
  const [placedWindows, setPlacedWindows] = useState([]);
  const viewerInstanceRef = useRef(null); 
  const [windowTypes, setWindowTypes] = useState({});

  useEffect(() => {
    Ion.defaultAccessToken =
      "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJqdGkiOiJlYjRkYzY2Ny1iM2U4LTRiMWYtODhlMS1kOTZiMTE1YmZmYTYiLCJpZCI6Mjk5MzYwLCJpYXQiOjE3NDYzNTEyMTh9.cyXf8dCAWqb0nDgoCbLywNeiqfzxTFPpSh6LMb2oz0o";

    const viewer = new Viewer(viewerRef.current);
    viewerInstanceRef.current = viewer;


    IonResource.fromAssetId(3410848)
      .then((resource) =>
        GeoJsonDataSource.load(resource, {
          stroke: Color.BLACK,
          strokeWidth: 1,
          clampToGround: false,
        })
      )
      .then((dataSource) => {
        viewer.dataSources.add(dataSource);

        const entities = dataSource.entities.values;
        let foundEntity = null;

        for (let entity of entities) {
          const entityUid = entity.properties?.uid?.getValue() || entity.id;

          if (entityUid === uid) {
            entity.show = true;
            foundEntity = entity;

            if (entity.polygon && entity.polygon.hierarchy) {
              const hierarchy = entity.polygon.hierarchy.getValue();
              if (hierarchy && hierarchy.positions) {
                const cartographics = hierarchy.positions.map((pos) =>
                  Cartographic.fromCartesian(pos, Ellipsoid.WGS84)
                );
                const hasZeroHeight = cartographics.some(
                  (c) => Math.abs(c.height) < 0.01
                );
                entity.polygon.material = hasZeroHeight
                  ? Color.WHITE.withAlpha(1.0)
                  : Color.RED.withAlpha(0.6);
              }
            }
          } else {
            entity.show = false;
          }
        }

        if (foundEntity) {
          viewer.flyTo(foundEntity, {
            duration: 2.5,
            offset: new HeadingPitchRange(0.0, -0.5, 100),
          });
        } else {
          console.warn("Building UID not found:", uid);
        }
      })
      .catch((err) => {
        console.error("Error loading building:", err);
      });

    return () => {
      if (viewer && !viewer.isDestroyed()) {
        viewer.destroy();
      }
    };
  }, [uid]);

  const handleUpload = async () => {
    if (!files.length) return;

    const formData = new FormData();
    for (let file of files) {
      formData.append("images", file);
    }

    await fetch(`http://localhost:5000/api/upload/${uid}`, {
      method: "POST",
      body: formData,
    });

    loadImages();
  };

  const handleShowSides = async () => {
    if (!viewerInstanceRef.current || !uid) {
      console.warn("Viewer not ready or UID missing");
      return;
    }

    try {
      const response = await fetch("/building_with_parts.geojson");
      const geojson = await response.json();

      const buildingFeatures = geojson.features.filter(
        (f) => f.properties?.uid === uid && f.geometry?.type === "MultiPolygon"
      );

      if (!buildingFeatures.length) {
        console.warn("No matching building found for UID:", uid);
        return;
      }

      let sideIndex = 1;
      const wallPolygons = [];

      for (const feature of buildingFeatures) {
        const multipolygon = feature.geometry.coordinates;

        for (const surface of multipolygon) {
          for (const ring of surface) {
            const isWall = ring.some((coord) => coord[2] === 0);
            if (!isWall) continue; // Only include surfaces with z = 0 (walls)

            const coords2D = ring.map(([lon, lat]) => [lon, lat]);

            wallPolygons.push({
              type: "Feature",
              geometry: {
                type: "Polygon",
                coordinates: [coords2D],
              },
              properties: {
                side: `Side ${sideIndex++}`,
              },
            });
          }
        }
      }

      if (wallPolygons.length === 0) {
        console.warn("No wall sides found (no z=0 polygons)");
        return;
      }

      const wallGeoJSON = {
        type: "FeatureCollection",
        features: wallPolygons,
      };

      const dataSource = await GeoJsonDataSource.load(wallGeoJSON, {
        clampToGround: false,
      });

      dataSource.name = `wall-sides-${uid}`;
      viewerInstanceRef.current.dataSources.add(dataSource);

      // Label each wall
      dataSource.entities.values.forEach((entity, i) => {
        entity.polygon.material = Color.ORANGE.withAlpha(0.5);
        entity.polygon.outline = true;
        entity.polygon.outlineColor = Color.BLACK;

        const positions = entity.polygon.hierarchy.getValue().positions;
        const center = positions.reduce(
          (sum, pos) => Cartesian3.add(sum, pos, new Cartesian3()),
          new Cartesian3(0, 0, 0)
        );
        Cartesian3.divideByScalar(center, positions.length, center);

        viewerInstanceRef.current.entities.add({
          position: center,
          label: {
            text: `Side ${i + 1}`,
            font: "14px sans-serif",
            fillColor: Color.BLACK,
            outlineColor: Color.WHITE,
            outlineWidth: 2,
            style: LabelStyle.FILL_AND_OUTLINE,
            verticalOrigin: VerticalOrigin.BOTTOM,
            heightReference: HeightReference.NONE,
          },
        });
      });

      console.log(`✅ Plotted ${wallPolygons.length} walls for ${uid}`);
    } catch (err) {
      console.error("❌ Failed to load wall sides:", err);
    }
  };

  useEffect(() => {
    const viewer = viewerRef.current?.cesiumElement || viewerRef.current?.cesiumWidget?.viewer;
    if (!viewer || !annotations.length || !uid) return;

    annotations.forEach((file) => {
      const imageBaseName = file.replace(".geojson", "");
      const url = `http://localhost:5000/placed_windows/${uid}/${imageBaseName}.geojson`;

      fetch(url)
        .then((res) => res.json())
        .then((geojson) => {
          const feature = geojson.features?.[0];
          if (!feature || feature.geometry.type !== "Polygon") return;

          // 🔧 Strip Z from coordinates if present
          const coords3D = feature.geometry.coordinates[0]; // possibly 3D
          const coords = coords3D.map(([lon, lat]) => [lon, lat]); // force 2D

          if (coords.length < 2) return;

          // Compute centroid
          const centroid = coords.reduce(
            (acc, [lon, lat]) => [acc[0] + lon, acc[1] + lat],
            [0, 0]
          ).map(sum => sum / coords.length);

          // Compute current polygon width in degrees
          const widthInDegrees = Math.abs(coords[1][0] - coords[0][0]);

          // Read width in meters from annotation metadata
          const originalWidthMeters = feature.properties?.widthInMeters;

          // Compute scale factor based on saved real-world width
          const degPerMeter = widthInDegrees / (originalWidthMeters || 1);
          const scaleFactor = (originalWidthMeters && widthInDegrees)
            ? (originalWidthMeters * degPerMeter) / widthInDegrees
            : 1;

          // Apply scaling to all points around centroid
          const scaledCoords = coords.map(([lon, lat]) => [
            centroid[0] + (lon - centroid[0]) * scaleFactor,
            centroid[1] + (lat - centroid[1]) * scaleFactor,
          ]);

          const scaledGeojson = {
            type: "FeatureCollection",
            features: [
              {
                ...feature,
                geometry: {
                  type: "Polygon",
                  coordinates: [scaledCoords],
                },
              },
            ],
          };

          return GeoJsonDataSource.load(scaledGeojson, {
            clampToGround: false,
          });
        })
        .then((dataSource) => {
          if (!dataSource) return;

          dataSource.name = `placed-${imageBaseName}`;
          viewer.dataSources.add(dataSource);

          const entities = dataSource.entities.values;
          for (let entity of entities) {
            if (entity.polygon) {
              const heightOffset = 1.5;
              entity.polygon.height = heightOffset;
              entity.polygon.extrudedHeight = heightOffset + 0.2;
              entity.polygon.material = Color.LIME.withAlpha(0.6);
              entity.polygon.outline = true;
              entity.polygon.outlineColor = Color.DARKGREEN;
            }
          }
        })
        .catch((err) => {
          console.warn(`Failed to load placed annotation ${url}:`, err.message);
        });
    });
  }, [annotations, uid]);

  const InfoTooltip = ({ imageName, metadata }) => {
    const [info, setInfo] = useState(null);
    const [visible, setVisible] = useState(false);

    // Extract base filename, e.g. IMG_1959.jpg
    const baseName = imageName.includes("_")
      ? imageName.split("_").slice(-2).join("_")
      : imageName;

    useEffect(() => {
      if (visible && !info) {
        fetch("/reference_lab.txt")
          .then((res) => res.text())
          .then((text) => {
            const lines = text.split("\n");
            const line = lines.find((l) => l.trim().startsWith(baseName));
            if (!line) {
              console.warn("No reference data found for", baseName);
              return;
            }

            const parts = line.split(",");
            setInfo({
              omega: parts[12],
              phi: parts[13],
              kappa: parts[14],
            });
          })
          .catch((err) => console.error("❌ Failed to load reference:", err));
      }
    }, [visible, info, baseName]);

    const tooltipContent = info
      ? 
        `Omega: ${info.omega ?? "-"}\n` +
        `Phi: ${info.phi ?? "-"}\n` +
        `Kappa: ${info.kappa ?? "-"}`
      : "Loading...";

    return (
      <div
        className={`tooltip-container ${visible ? "show" : ""}`}
        onMouseEnter={() => setVisible(true)}
        onMouseLeave={() => setVisible(false)}
        style={{ cursor: "pointer", marginRight: 8, position: "relative", display: "inline-block" }}
      >
        <FaInfoCircle color="blue" size={20} />
        {visible && (
          <div
            style={{
              visibility: "visible",
              width: "max-content",
              maxWidth: "300px",
              backgroundColor: "#333",
              color: "#fff",
              textAlign: "left",
              borderRadius: "6px",
              padding: "8px",
              position: "absolute",
              zIndex: 100,
              top: "120%",
              left: 0,
              opacity: 1,
              transition: "opacity 0.3s",
              fontSize: "0.85rem",
              whiteSpace: "pre-line",
            }}
          >
            {tooltipContent}
          </div>
        )}
      </div>
    );
  };

  useEffect(() => {
    async function loadJenisJendelaForAll() {
      const types = {};

      for (const filename of placedWindows) {
        const imageBaseName = filename.replace(".geojson", "");
        const encoded = encodeURIComponent(`${imageBaseName}.geojson`);
        const url = `http://localhost:5000/api/placed_windows/${uid}/${encoded}`;

        try {
          const res = await fetch(url);
          if (!res.ok) continue;

          const geojson = await res.json();
          const firstFeature = geojson.features?.[0];
          const jenis = firstFeature?.properties?.jenisJendela || "";
          types[filename] = jenis;
        } catch (err) {
          console.error(`❌ Failed to load jenisJendela for ${filename}:`, err);
        }
      }

      setWindowTypes(types);
    }

    if (placedWindows.length > 0) {
      loadJenisJendelaForAll();
    }
  }, [placedWindows, uid]);

  // Move function outside useEffect
  const loadPlacedWindows = async () => {
    try {
      console.log("🔄 Refreshing placed windows...");
      const res = await fetch(`http://localhost:5000/api/placed_windows/${uid}`);
      if (!res.ok) throw new Error("Failed to fetch placed windows.");
      const data = await res.json();
      setPlacedWindows(data);
    } catch (err) {
      console.error("Error loading placed windows:", err);
    }
  };

  const showImageInfo = async (imageName, cleanMetadata) => {
    try {
      const res = await fetch("/reference_lab.txt"); // must be in /public/
      const text = await res.text();
      const lines = text.split("\n");
      const line = lines.find((l) => l.startsWith(imageName));
      if (!line) {
        console.warn("No reference data found for", imageName);
        return;
      }

      const parts = line.split(",");
      const omega = parts[12];
      const phi = parts[13];
      const kappa = parts[14];

      console.log("FocalLength:", cleanMetadata.FocalLength);
      console.log("ImageWidth:", cleanMetadata.ExifImageWidth);
      console.log("ImageHeight:", cleanMetadata.ExifImageHeight);
      console.log("Omega:", omega);
      console.log("Phi:", phi);
      console.log("Kappa:", kappa);
    } catch (err) {
      console.error("❌ Error reading reference_lab.txt", err);
    }
  };

  useEffect(() => {
    if (uid) {
      loadPlacedWindows();
    }
  }, [uid]);

  // Also move loadImages outside
  const loadImages = async () => {
    try {
      const res = await fetch(`http://localhost:5000/api/images/${uid}`);
      if (!res.ok) throw new Error("Failed to fetch images.");
      const data = await res.json();
      setImages(data);
    } catch (err) {
      console.error("Error loading images:", err);
    }
  };

  useEffect(() => {
    if (uid) {
      loadImages();
    }
  }, [uid]);

  const loadAnnotations = async () => {
    console.log("🔄 loadAnnotations() called");
    try {
      const res = await fetch(`http://localhost:5000/api/annotations/${uid}`);
      if (!res.ok) {
        console.warn("❌ Failed to fetch annotations");
        return;
      }
      const files = await res.json();
      console.log("✅ New annotations:", files);
      setAnnotations(files);
    } catch (err) {
      console.error("❌ Error loading annotations:", err);
    }
  };


  useEffect(() => {
    loadAnnotations();
  }, [uid]);

  useEffect(() => {
    if (!viewerInstanceRef.current || placedWindows.length === 0) return;

    placedWindows.forEach((filename) => {
      const placedWindowUrl = `http://localhost:5000/placed/${uid}/${filename}`;
      handlePlace(viewerInstanceRef.current, placedWindowUrl, uid);
    });
  }, [placedWindows, viewerInstanceRef.current]);

  useEffect(() => {
    loadPlacedWindows();
  }, []);

  return (
    <div style={{ display: "flex", height: "100vh", position: "relative" }}>
      {/* Left: 3D Viewer */}
      <div ref={viewerRef} style={{ flex: 15 }} />

      {/* Right: Info Panel */}
      <div
        style={{
          flex: 4,
          padding: "20px",
          backgroundColor: "#f8f8f8",
          overflowY: "auto",
        }}
      >
        <button
          onClick={() => navigate("/")}
          style={{
            marginBottom: "20px",
            padding: "8px 12px",
            borderRadius: "4px",
            fontWeight: "bold",
            cursor: "pointer",
          }}
        >
          ← Back
        </button>

        <div style={{ marginBottom: "20px" }}>
          <h3>Building Details</h3>
          <p>
            <strong>ID:</strong> {uid}
          </p>
          <button
            onClick={handleShowSides}
            style={{
              background: "none",
              border: "1px solid blue",
              color: viewerInstanceRef.current ? "#28a745" : "#ccc",
              padding: "2px 6px",
              fontSize: "0.9rem",
              cursor: viewerInstanceRef.current ? "pointer" : "not-allowed",
              borderRadius: "4px",
            }}
          >
            Show Sides 
          </button>
        </div>

        <div style={{ marginBottom: "20px" }}>
          <h4>Upload Photos</h4>
          <input
            type="file"
            multiple
            onChange={(e) => setFiles(e.target.files)}
          />
          <button
            onClick={handleUpload}
            style={{ display: "block", marginTop: "10px" }}
          >
            Submit
          </button>
        </div>

        <div style={{ marginBottom: "20px" }}>
          <h4 style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <span>List Building Photos</span>
            <button
              onClick={loadImages}
              title="Refresh list"
              style={{
                background: "none",
                border: "none",
                cursor: "pointer",
                fontSize: "1.1rem",
                color: "#007bff",
                padding: 0,
              }}
            >
              <FaSyncAlt />
            </button>
          </h4>
          {images.length === 0 ? (
            <p>No photos available.</p>
          ) : (
            <ul style={{ listStyleType: "none", paddingLeft: 0 }}>
              {images.map((img) => (
                <li
                  key={img.name}
                  style={{
                    marginBottom: "10px",
                    display: "flex",
                    alignItems: "center",
                  }}
                >
                  <span style={{ flex: 1 }}>{img.name}</span>

                  {/* 👁️ Preview Button */}
                  <button
                    onClick={() => {
                      setSelectedImage(`http://localhost:5000${img.url}`);
                      setIsAnnotating(false);
                    }}
                    style={{
                      marginRight: 8,
                      background: "none",
                      border: "none",
                      cursor: "pointer",
                      fontSize: "1.2rem",
                      color: "#007bff",
                    }}
                    title="Preview"
                  >
                    <FaEye />
                  </button>

                  <InfoTooltip imageName={img.name} metadata={img.metadata} />


                  <button
                    onClick={async () => {
                      const confirmed = window.confirm(`Delete ${img.name}?`);
                      if (!confirmed) return;

                      try {
                        const res = await fetch(
                          `http://localhost:5000/api/images/${uid}/${encodeURIComponent(img.name)}`,
                          { method: "DELETE" }
                        );
                        if (res.ok) {
                          setImages((prev) => prev.filter((f) => f.name !== img.name));
                        } else {
                          alert("❌ Failed to delete image.");
                        }
                      } catch (err) {
                        console.error("❌ Delete error:", err);
                      }
                    }}
                    title="Delete"
                    style={{
                      marginRight: 8,
                      background: "none",
                      border: "none",
                      cursor: "pointer",
                      fontSize: "1.2rem",
                      color: "red",
                    }}
                  >
                    <FaTrash />
                  </button>

                  {/* ✏️ Annotate Button */}
                  <button
                    onClick={() => {
                      setSelectedImage(`http://localhost:5000${img.url}`);
                      setIsAnnotating(true);
                    }}
                    style={{
                      background: "none",
                      border: "1px solid #28a745",
                      color: "#28a745",
                      padding: "2px 6px",
                      fontSize: "0.9rem",
                      cursor: "pointer",
                      borderRadius: "4px",
                    }}
                  >
                    Annotate
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div style={{ marginBottom: "20px" }}>
          <h4 style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <span>List Annotated Building Photos</span>
            <button
              onClick={loadAnnotations}
              title="Refresh annotations"
              style={{
                background: "none",
                border: "none",
                cursor: "pointer",
                fontSize: "1.1rem",
                color: "#007bff",
                padding: 0,
              }}
            >
              <FaSyncAlt />
            </button>
          </h4>
          {annotations.length === 0 ? (
            <p>No annotated photos available.</p>
          ) : (
            <ul style={{ listStyleType: "none", paddingLeft: 0 }}>
              {annotations.map((file) => (
                <li
                  key={file}
                  style={{
                    marginBottom: "10px",
                    display: "flex",
                    alignItems: "center",
                  }}
                >
                  <span style={{ flex: 1 }}>{file}</span>

                  {/* 👁️ View Annotation */}
                  <button
                    onClick={() => {
                      const imgName = file.replace(".geojson", "");
                      setShowingAnnotation({
                        imageUrl: `http://localhost:5000/uploaded/${uid}/${imgName}`,
                        geojsonUrl: `http://localhost:5000/annotations/${uid}/${file}`,
                        imageName: imgName,
                      });
                    }}
                    style={{
                      background: "none",
                      border: "none",
                      cursor: "pointer",
                      fontSize: "1.2rem",
                      color: "#007bff",
                      marginRight: 8,
                    }}
                    title="View Annotation"
                  >
                    <FaEye />
                  </button>

                  {/* 🗑️ Delete Annotation */}
                  <button
                    onClick={async () => {
                      const confirmed = window.confirm(`Delete annotation ${file}?`);
                      if (!confirmed) return;

                      try {
                        const res = await fetch(
                          `http://localhost:5000/api/annotations/${uid}/${encodeURIComponent(file)}`,
                          { method: "DELETE" }
                        );

                        if (res.ok) {
                          setAnnotations((prev) => prev.filter((f) => f !== file));
                        } else {
                          alert("❌ Failed to delete annotation.");
                        }
                      } catch (err) {
                        console.error("❌ Delete error:", err);
                      }
                    }}
                    title="Delete Annotation"
                    style={{
                      background: "none",
                      border: "none",
                      cursor: "pointer",
                      fontSize: "1.2rem",
                      color: "red",
                    }}
                  >
                    <FaTrash />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div style={{ marginBottom: "20px" }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
            }}
          >
            <h4 style={{ margin: 0 }}>List Placed Windows</h4>
            <button
              onClick={loadPlacedWindows}
              title="Refresh placed windows"
              style={{
                background: "none",
                border: "none",
                cursor: "pointer",
                fontSize: "1.1rem",
                color: "#007bff",
                padding: 0,
              }}
            >
              <FaSyncAlt />
            </button>
          </div>

          {placedWindows.length === 0 ? (
            <p>No placed windows available.</p>
          ) : (
            <ul style={{ listStyleType: "none", paddingLeft: 0 }}>
              {placedWindows.map((filename) => (
                <React.Fragment key={filename}>
                  {/* List Item */}
                  <li
                    style={{
                      marginBottom: "10px",
                      display: "flex",
                      alignItems: "center",
                      gap: "10px",
                    }}
                  >
                    <span style={{ flex: 1 }}>{filename}</span>
                    <button
                      onClick={async () => {
                        const confirmed = window.confirm(`Delete ${filename}?`);
                        if (!confirmed) return;

                        try {
                          const res = await fetch(
                            `http://localhost:5000/api/placed/${uid}/${encodeURIComponent(
                              filename
                            )}`,
                            { method: "DELETE" }
                          );

                          if (res.ok) {
                            if (viewerInstanceRef.current) {
                              const viewer = viewerInstanceRef.current;
                              const entitiesToRemove = viewer.entities.values.filter(
                                (e) => e.name === filename
                              );
                              entitiesToRemove.forEach((e) => viewer.entities.remove(e));
                            }

                            setPlacedWindows((prev) => prev.filter((f) => f !== filename));
                          } else {
                            alert("❌ Failed to delete from server.");
                          }
                        } catch (err) {
                          console.error("❌ Delete error:", err);
                        }
                      }}
                      style={{
                        background: "none",
                        border: "none",
                        color: "red",
                        cursor: "pointer",
                        fontSize: "1rem",
                      }}
                      title="Delete"
                    >
                      <FaTrash />
                    </button>
                  </li>
                  
                  {/* Input and Save Button - outside the li but associated with it */}
                  <div style={{ display: "flex", gap: "5px", marginLeft: "10px", marginBottom: "15px" }}>
                    <input
                      type="text"
                      placeholder="Jenis Jendela"
                      id={`window-type-${filename}`}
                      defaultValue={windowTypes[filename] || ""}
                      style={{ flex: 1, padding: "5px" }}
                    />
                    <button
                      onClick={async () => {
                        const windowType = document.getElementById(`window-type-${filename}`).value;
                        if (!windowType) {
                          alert("Please enter jenis jendela");
                          return;
                        }

                        try {
                          const imageBaseName = filename.replace('.geojson', '');
                          const encodedFilename = encodeURIComponent(`${imageBaseName}.geojson`);
                          const url = `http://localhost:5000/api/placed_windows/${uid}/${encodedFilename}`; // ✅ FIXED

                          console.log('🔍 Attempting to fetch:', url);
                          const response = await fetch(url);

                          if (!response.ok) {
                            console.error('❌ Fetch failed with status:', response.status);
                            const errorText = await response.text();
                            console.error('❌ Error response:', errorText);
                            throw new Error(`HTTP error! status: ${response.status}`);
                          }

                          const geojson = await response.json();
                          console.log('✅ Existing GeoJSON:', geojson);

                          // Inject jenis jendela into each feature's properties
                          if (geojson.features && Array.isArray(geojson.features)) {
                            geojson.features.forEach(feature => {
                              if (!feature.properties) feature.properties = {};
                              feature.properties.jenisJendela = windowType;
                            });
                          }

                          // PUT updated GeoJSON back to server
                          const saveUrl = `http://localhost:5000/api/placed_windows/${uid}/${encodedFilename}`; // ✅ FIXED
                          const putResponse = await fetch(saveUrl, {
                            method: 'PUT',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify(geojson, null, 2),
                          });

                          if (!putResponse.ok) {
                            throw new Error(`Failed to save updated GeoJSON. Status: ${putResponse.status}`);
                          }

                          alert("✅ Jenis jendela saved successfully!");
                        } catch (err) {
                          console.error("❌ Full error details:", err);
                          alert(`Error saving jenis jendela: ${err.message}`);
                        }
                      }}
                    >
                      Save
                    </button>
                  </div>
                </React.Fragment>
              ))}
            </ul>
          )}
          
        </div>

        {showingAnnotation && (
          <div
            style={{
              position: "absolute",
              bottom: 0,
              left: 0,
              right: "18.4%",
              height: "75%",
              backgroundColor: "#fff",
              overflow: "hidden",
              zIndex: 12,
              display: "flex",
              flexDirection: "column",
            }}
          >
            <ShowAnnotation
              imageUrl={showingAnnotation.imageUrl}
              geojsonUrl={showingAnnotation.geojsonUrl}
              imageName={showingAnnotation.imageName}
              buildingId={uid}  // ✅ pass buildingId here
              onClose={() => setShowingAnnotation(null)}
            />

          </div>
        )}

      </div>

      {/* Image Preview Panel */}
      {selectedImage && !isAnnotating && (
        <div
          style={{
            position: "absolute",
            bottom: 0,
            left: 0,
            right: "18.4%",
            height: "75%",
            backgroundColor: "#fff",
            overflow: "hidden",
            zIndex: 10,
            display: "flex",
            flexDirection: "column",
          }}
        >
          <div
            style={{
              padding: "6px 10px",
              borderBottom: "1px solid #ccc",
              fontWeight: "bold",
              backgroundColor: "#f0f0f0",
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
            }}
          >
            <span>Preview</span>
            <div>
              <button
                onClick={() => {
                  setIsAnnotating(true);
                }}
                style={{
                  marginRight: "10px",
                  padding: "4px 8px",
                  border: "1px solid #007bff",
                  color: "#007bff",
                  background: "none",
                  borderRadius: "4px",
                  fontSize: "0.85rem",
                  cursor: "pointer",
                }}
              >
                ✏️ Annotate
              </button>
              <button
                onClick={() => setSelectedImage(null)}
                style={{
                  background: "none",
                  border: "none",
                  fontWeight: "bold",
                  cursor: "pointer",
                  fontSize: "1rem",
                }}
              >
                ✕
              </button>
            </div>
          </div>

          <img
            src={selectedImage}
            alt="preview"
            style={{
              maxHeight: "100%",
              width: "auto",
              objectFit: "contain",
              alignSelf: "center",
            }}
          />
        </div>
      )}

      {/* Image Annotation Mode */}
      {selectedImage && isAnnotating && (
        <div
          style={{
            position: "absolute",
            bottom: 0,
            left: 0,
            right: "18.4%",
            height: "75%",
            backgroundColor: "#fff",
            overflow: "hidden",
            zIndex: 11,
            display: "flex",
            flexDirection: "column",
          }}
        >
          <ImageAnnotator
            imageUrl={selectedImage}
            buildingId={uid}
            imageName={selectedImage.split("/").pop()}
            onClose={() => {
              setSelectedImage(null);
              setIsAnnotating(false);
            }}
          />
        </div>
      )}
    </div>
  );
};

export default ZoomBuilding;
