import React, { useEffect, useRef, useState } from "react";
import { Stage, Layer, Rect, Line, Image as KonvaImage } from "react-konva";
import useImage from "use-image";
import exifr from "exifr";

const ShowAnnotation = ({ imageUrl, geojsonUrl, imageName, buildingId, onClose }) => {
  const [img] = useImage(imageUrl);
  const [rects, setRects] = useState([]);
  const [scale, setScale] = useState(1);
  const [rawGeoJSON, setRawGeoJSON] = useState(null);
  const stageRef = useRef();

  useEffect(() => {
    if (!img) return;
    const maxWidth = 900;
    const maxHeight = 600;
    const scaleW = maxWidth / img.width;
    const scaleH = maxHeight / img.height;
    setScale(Math.min(scaleW, scaleH, 1));
  }, [img]);

  useEffect(() => {
    const loadAndProject = async () => {
      const geo = await fetch(geojsonUrl).then((res) => res.json());
      setRawGeoJSON(geo); // ✅ save full geojson for server post

      const imgBlob = await fetch(imageUrl).then((res) => res.blob());
      const gps = await exifr.parse(imgBlob, { gps: true });

      if (!gps || !gps.latitude || !gps.longitude || !geo.features.length) {
        alert("Missing GPS metadata or invalid annotation.");
        return;
      }

      const centerLat = gps.latitude;
      const centerLon = gps.longitude;
      const imageWidth = img.naturalWidth || img.width;
      const imageHeight = img.naturalHeight || img.height;

      const feature = geo.features[0];
      const meterPerPixel = feature.properties?.meterPerPixel || 0.01;

      const latLonToPixel = ([lon, lat]) => {
        const dx = (lon - centerLon) * 111320 * Math.cos(centerLat * Math.PI / 180);
        const dy = (centerLat - lat) * 110540;
        return {
          x: imageWidth / 2 + dx / meterPerPixel,
          y: imageHeight / 2 + dy / meterPerPixel,
        };
      };

      const pixelPolygons = geo.features
        .filter(f => f.geometry.type === "Polygon")
        .map(f => {
          const coords = f.geometry.coordinates[0].map(c => latLonToPixel(c));
          return coords;
        });

      setRects(pixelPolygons);

    };

    if (img) loadAndProject();
  }, [geojsonUrl, imageUrl, img]);

  const handlePlaceOnBuilding = async () => {
    if (!rawGeoJSON) return alert("No annotation data to send.");

    const geojsonToSend = JSON.parse(JSON.stringify(rawGeoJSON));
    geojsonToSend.features.forEach((feature) => {
      feature.properties = feature.properties || {};
      feature.properties.imageName = imageName;
      feature.properties.buildingId = buildingId;
    });

    const res = await fetch("http://localhost:5000/api/placeAnnotationOnBuilding", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(geojsonToSend),
    });

    if (res.ok) {
      alert("✅ Annotation polygon placed on building!");
    } else {
      alert("❌ Failed to place annotation on building.");
    }
  };

  return (
    <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column" }}>
      <div
        style={{
          padding: 10,
          background: "#f0f0f0",
          display: "flex",
          justifyContent: "space-between",
          borderBottom: "1px solid #ccc",
        }}
      >
        <strong>View Annotation: {imageName}</strong>
        <div>
          <button onClick={handlePlaceOnBuilding} style={{ marginRight: 10 }}>
            🏢 Place All Windows
          </button>
          <button onClick={onClose}>✕ Close</button>
        </div>
      </div>

      <div
        style={{
          flex: 1,
          display: "flex",
          justifyContent: "center",
          alignItems: "center",
          backgroundColor: "#000",
        }}
      >
        {img && (
          <Stage
            width={img.width * scale}
            height={img.height * scale}
            scale={{ x: scale, y: scale }}
            ref={stageRef}
          >
            <Layer>
              <KonvaImage image={img} />
              {rects.map((polygon, idx) => (
                <Line
                  key={idx}
                  points={polygon.flatMap(p => [p.x, p.y])}
                  closed
                  stroke="lime"
                  strokeWidth={2 / scale}
                  fill="rgba(0,255,0,0.2)"
                />
              ))}
            </Layer>
          </Stage>
        )}
      </div>
    </div>
  );
};

export default ShowAnnotation;
