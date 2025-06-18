import React, { useEffect, useRef, useState } from "react";
import { Stage, Layer, Rect, Image as KonvaImage } from "react-konva";
import useImage from "use-image";
import exifr from "exifr";

const ImageAnnotator = ({ imageUrl, buildingId, imageName, onClose }) => {
  const [img] = useImage(imageUrl);
  const [rects, setRects] = useState([]);
  const [newRect, setNewRect] = useState(null);
  const [imageMetadata, setImageMetadata] = useState(null);
  const stageRef = useRef();
  const [scale, setScale] = useState(1);

  useEffect(() => {
    fetch(imageUrl)
      .then((res) => res.blob())
      .then((blob) => exifr.parse(blob, { gps: true, xmp: true, tiff: true }))
      .then((data) => {
        console.log("📷 RAW EXIF metadata:", data);

        let lat = data.latitude;
        let lon = data.longitude;

        if (Array.isArray(data.GPSLatitude)) {
          const [d, m, s] = data.GPSLatitude;
          lat = d + m / 60 + s / 3600;
          if (data.GPSLatitudeRef === "S") lat = -lat;
        }

        if (Array.isArray(data.GPSLongitude)) {
          const [d, m, s] = data.GPSLongitude;
          lon = d + m / 60 + s / 3600;
          if (data.GPSLongitudeRef === "W") lon = -lon;
        }

        const cleanMetadata = {
          ...data,
          latitude: lat,
          longitude: lon,
        };

        setImageMetadata(cleanMetadata);

        console.log("📌 Cleaned Metadata for Placement:");
        console.log("Latitude:", cleanMetadata.latitude);
        console.log("Longitude:", cleanMetadata.longitude);
        console.log("Altitude:", cleanMetadata.GPSAltitude);
        console.log("FocalLength:", cleanMetadata.FocalLength);
        console.log("ImageWidth:", cleanMetadata.ExifImageWidth);
        console.log("ImageHeight:", cleanMetadata.ExifImageHeight);
      })
      .catch((err) => {
        console.error("❌ Failed to parse EXIF:", err);
        alert("Failed to read image metadata.");
      });
  }, [imageUrl]);

  useEffect(() => {
    if (img) {
      const maxWidth = 900;
      const maxHeight = 600;
      const scaleW = maxWidth / img.width;
      const scaleH = maxHeight / img.height;
      setScale(Math.min(scaleW, scaleH, 1));
    }
  }, [img]);

  const handleMouseDown = () => {
    const pos = stageRef.current.getPointerPosition();
    const unscaled = { x: pos.x / scale, y: pos.y / scale };
    setNewRect({ x: unscaled.x, y: unscaled.y, width: 0, height: 0 });
  };

  const handleMouseMove = () => {
    if (!newRect) return;
    const pos = stageRef.current.getPointerPosition();
    const unscaled = { x: pos.x / scale, y: pos.y / scale };
    const width = unscaled.x - newRect.x;
    const height = unscaled.y - newRect.y;
    setNewRect({ ...newRect, width, height });
  };

  const handleMouseUp = () => {
    if (newRect && Math.abs(newRect.width) > 5 && Math.abs(newRect.height) > 5) {
      setRects([...rects, newRect]);
    }
    setNewRect(null);
  };

  const convertToGeoJSON = () => {
    if (!imageMetadata || !img) return null;

    const {
      latitude,
      longitude,
      GPSAltitude,
      FocalLength,
      ExifImageWidth,
    } = imageMetadata;

    const alt = parseFloat(GPSAltitude) || 0;
    const imgWidth = ExifImageWidth || img.width;

    const sensorWidth = 5.6; // mm (iPhone wide camera typical)
    const focal = parseFloat(FocalLength) || 6.0; // fallback to typical iPhone value
    const mmPerPixel = sensorWidth / imgWidth;
    const distance = 10; // meters to wall, adjust if needed
    const meterPerPixel = (mmPerPixel * distance) / focal / 1000;

    console.log("📐 Placement calculation:");
    console.log("mmPerPixel:", mmPerPixel);
    console.log("meterPerPixel:", meterPerPixel);

    const pixelToLatLonAlt = (pt) => {
      const dx = pt.x - img.width / 2;
      const dy = pt.y - img.height / 2;
      const lon = longitude + (dx * meterPerPixel) / (111320 * Math.cos(latitude * Math.PI / 180));
      const lat = latitude - (dy * meterPerPixel) / 110540;
      return [lon, lat, alt];
    };

    const features = rects.map((r) => {
      const x1 = r.x;
      const y1 = r.y;
      const x2 = r.x + r.width;
      const y2 = r.y + r.height;
      const corners = [
        { x: x1, y: y1 },
        { x: x2, y: y1 },
        { x: x2, y: y2 },
        { x: x1, y: y2 },
      ];
      const coords = corners.map(pixelToLatLonAlt);
      coords.push(coords[0]);

      return {
        type: "Feature",
        geometry: {
          type: "Polygon",
          coordinates: [coords],
        },
        properties: {
          imageName,
          buildingId,
          source: "photo-annotation",
          altitude: alt,
          meterPerPixel,
          widthInMeters: Math.abs(r.width) * meterPerPixel,
          heightInMeters: Math.abs(r.height) * meterPerPixel,
        },
      };
    });

    console.log("🧾 Generated GeoJSON:", features);

    return {
      type: "FeatureCollection",
      features,
    };
  };

  const handleSave = async () => {
    const geojson = convertToGeoJSON();
    if (!geojson) return alert("Missing GPS metadata or image not loaded.");

    const res = await fetch(
      `http://localhost:5000/api/annotations/${buildingId}/${imageName}.geojson`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(geojson),
      }
    );

    if (res.ok) {
      alert("Annotation saved!");
      onClose();
    } else {
      alert("Failed to save annotation.");
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
        <strong>Annotate: {imageName}</strong>
        <div>
          <button onClick={handleSave} style={{ marginRight: 8 }}>💾 Save Annotation</button>
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
            onMouseDown={handleMouseDown}
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
            style={{
              boxShadow: "0 0 6px rgba(0,0,0,0.3)",
              backgroundColor: "#000",
              cursor: "crosshair",
            }}
          >
            <Layer>
              <KonvaImage image={img} />
              {rects.map((r, idx) => (
                <Rect
                  key={idx}
                  x={r.x}
                  y={r.y}
                  width={r.width}
                  height={r.height}
                  stroke="red"
                  strokeWidth={2 / scale}
                  fill="rgba(255,0,0,0.2)"
                />
              ))}
              {newRect && (
                <Rect
                  x={newRect.x}
                  y={newRect.y}
                  width={newRect.width}
                  height={newRect.height}
                  stroke="yellow"
                  dash={[10, 5]}
                  strokeWidth={2 / scale}
                />
              )}
            </Layer>
          </Stage>
        )}
      </div>
    </div>
  );
};

export default ImageAnnotator;
