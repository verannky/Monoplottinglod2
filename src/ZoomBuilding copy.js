import React, { useEffect, useRef, useState } from "react";
import { FaEye } from "react-icons/fa";
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



  const loadImages = async () => {
    const res = await fetch(`http://localhost:5000/api/images/${uid}`);
    const data = await res.json();
    setImages(data);
  };

  useEffect(() => {
    loadImages();
  }, [uid]);

  const loadAnnotations = async () => {
    try {
      const res = await fetch(`http://localhost:5000/api/annotations/${uid}`);
      if (!res.ok) return;
      const files = await res.json();
      setAnnotations(files);
    } catch (err) {
      console.error("Failed to load annotations", err);
    }
  };

  useEffect(() => {
    loadAnnotations();
  }, [uid]);

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


  useEffect(() => {
    const loadPlacedWindows = async () => {
      try {
        const res = await fetch(`http://localhost:5000/api/placed_windows/${uid}`);
        if (!res.ok) throw new Error("Failed to fetch placed windows.");
        const data = await res.json();
        setPlacedWindows(data);
      } catch (err) {
        console.error("Error loading placed windows:", err);
      }
    };
    loadPlacedWindows();
  }, [uid]);

  return (
    <div style={{ display: "flex", height: "100vh", position: "relative" }}>
      {/* Left: 3D Viewer */}
      <div ref={viewerRef} style={{ flex: 15 }} />

      {/* Right: Info Panel */}
      <div
        style={{
          flex: 3,
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
          <h4>List Building Photos</h4>
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
          <h4>List Annotated Building Photos</h4>
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
                    }}
                    title="View Annotation"
                  >
                    <FaEye />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div style={{ marginBottom: "20px" }}>
          <h4>List Placed Windows</h4>
          {placedWindows.length === 0 ? (
            <p>No placed windows available.</p>
          ) : (
            <ul style={{ listStyleType: "none", paddingLeft: 0 }}>
              {placedWindows.map((filename) => (
                <li
                  key={filename}
                  style={{
                    marginBottom: "10px",
                    display: "flex",
                    alignItems: "center",
                  }}
                >
                  <span style={{ flex: 1 }}>{filename}</span>
                  <button
                    onClick={() => {
                      if (!viewerInstanceRef.current) {
                        console.warn("⚠️ Viewer not ready yet.");
                        return;
                      }
                      const placedWindowUrl = `http://localhost:5000/placed/${uid}/${filename}`;
                      handlePlace(viewerInstanceRef.current, placedWindowUrl, uid);
                    }}
                    disabled={!viewerInstanceRef.current}
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
                    Place
                  </button>
                </li>
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
