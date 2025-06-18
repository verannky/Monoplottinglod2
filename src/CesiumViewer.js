// src/CesiumViewer.js
import React, { useEffect, useRef, useState } from "react";
import {
  Ion,
  IonResource,
  Viewer,
  GeoJsonDataSource,
  Color,
  ScreenSpaceEventHandler,
  ScreenSpaceEventType,
  Cartographic,
  Ellipsoid,
  defined,
  EllipsoidGeodesic
} from "cesium";
import { useNavigate } from "react-router-dom";
import "cesium/Build/Cesium/Widgets/widgets.css";
import area from '@turf/area';
import { polygon } from '@turf/helpers';

const formatRupiah = (value) => {
  if (typeof value !== "number" || isNaN(value)) return "N/A";
  return "Rp " + value.toLocaleString("id-ID");
};

async function calculateFootprintAreaFromGeoJSON(buildingId) {
  try {
    const res = await fetch('/building_with_parts.geojson');
    const geojson = await res.json();

    const matchingFeatures = geojson.features.filter(
      (f) => f.properties?.uid === buildingId && f.geometry?.type === 'MultiPolygon'
    );

    let totalArea = 0;

    for (const feature of matchingFeatures) {
      const multiPolygonCoords = feature.geometry.coordinates;

      const flatPolygons = multiPolygonCoords
        .map((poly) => {
          const ring = poly[0];
          const isFlat = ring.every((pt) => pt[2] === 0.0);
          if (isFlat) {
            const flatRing = ring.map(([lon, lat]) => [lon, lat]);
            const first = flatRing[0];
            const last = flatRing[flatRing.length - 1];
            if (first[0] !== last[0] || first[1] !== last[1]) {
              flatRing.push(first);
            }
            return flatRing;
          }
          return null;
        })
        .filter(Boolean);

      for (const ring of flatPolygons) {
        const poly = polygon([ring]);
        totalArea += area(poly);
      }
    }

    return totalArea;
  } catch (e) {
    console.error("❌ Gagal menghitung area dari GeoJSON:", e);
    return 0;
  }
}


const CesiumViewer = () => {
  const viewerRef = useRef(null);
  const navigate = useNavigate();
  const [buildingInfo, setBuildingInfo] = useState(null);

  useEffect(() => {
    if (!viewerRef.current) return;

    Ion.defaultAccessToken =
      "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJqdGkiOiJlYjRkYzY2Ny1iM2U4LTRiMWYtODhlMS1kOTZiMTE1YmZmYTYiLCJpZCI6Mjk5MzYwLCJpYXQiOjE3NDYzNTEyMTh9.cyXf8dCAWqb0nDgoCbLywNeiqfzxTFPpSh6LMb2oz0o";

    const viewer = new Viewer(viewerRef.current, {
      infoBox: false,
      selectionIndicator: false,
    });

    let clickHandler;

    IonResource.fromAssetId(3410848)
      .then((resource) =>
        GeoJsonDataSource.load(resource, {
          stroke: Color.BLACK,
          strokeWidth: 1,
          clampToGround: false,
        })
      )
      .then((dataSource) => {
        if (!viewer || viewer.isDestroyed?.()) return;
        viewer.dataSources.add(dataSource);
        viewer.zoomTo(dataSource);

        dataSource.entities.values.forEach((entity) => {
          if (!entity.polygon || !entity.polygon.hierarchy) return;
          const hierarchy = entity.polygon.hierarchy.getValue();
          if (!hierarchy || !hierarchy.positions) return;

          const cartographics = hierarchy.positions.map((pos) =>
            Cartographic.fromCartesian(pos, Ellipsoid.WGS84)
          );
          const hasZeroHeight = cartographics.some(
            (c) => Math.abs(c.height) < 0.01
          );

          entity.polygon.material = hasZeroHeight
            ? Color.WHITE.withAlpha(1.0)
            : Color.RED.withAlpha(0.6);
        });

        // Click handler
        clickHandler = new ScreenSpaceEventHandler(viewer.scene.canvas);
        clickHandler.setInputAction(async (movement) => {
          const picked = viewer.scene.pick(movement.position);
          if (!picked || !picked.id || !defined(picked.id.properties)) return;

          const props = picked.id.properties;
          const uid = props.uid?.getValue?.() || picked.id.id;
          const buildingId = props.buildingId?.getValue?.() || uid;

          try {
            // --- 1. Ambil file jendela (GeoJSON per gedung)
            let files = [];
            try {
              const res = await fetch(`http://localhost:5000/api/placed_windows/${buildingId}`);
              if (res.ok) files = await res.json();
              else console.warn("⚠️ Tidak ada data jendela ditemukan.");
            } catch (e) {
              console.warn("⚠️ Gagal mengambil daftar jendela:", e);
            }

            // --- 2. Hitung jumlah total jendela
            let totalCount = 0;
            for (const filename of files) {
              try {
                const geojsonRes = await fetch(
                  `http://localhost:5000/placed/${buildingId}/${encodeURIComponent(filename)}`
                );
                const geojson = await geojsonRes.json();
                totalCount += geojson.features?.length || 0;
              } catch (e) {
                console.warn(`⚠️ Gagal mengambil atau memproses file ${filename}:`, e);
              }
            }

            const windowCount = totalCount;
            const qualityBonus = windowCount >= 10 ? 0.10 : windowCount >= 5 ? 0.05 : 0.0;

            // --- 3. Ambil nilai properti dasar, gunakan fallback jika kosong
            const fallbackNJOPBangunanPerM2 = 1200000; // rata-rata Cimahi (contoh)
            const fallbackNJOPTanahPerM2 = 900000;     // rata-rata Cimahi (contoh)
            const fallbackLandArea = 100;              // fallback luas tanah standar

            const njopBangunanPerM2 = props.njopBangunanPerM2?.getValue?.() || fallbackNJOPBangunanPerM2;
            const njopTanahPerM2 = props.njopTanahPerM2?.getValue?.() || fallbackNJOPTanahPerM2;
            const landArea = props.landArea?.getValue?.() || fallbackLandArea;


            // --- 4. Hitung luas bangunan dari GeoJSON (alas yang datar/z=0)
            let footprintArea = await calculateFootprintAreaFromGeoJSON(buildingId);

            // --- 5. Hitung NJOP
            const buildingNJOP = footprintArea * njopBangunanPerM2;
            const landNJOP = landArea * njopTanahPerM2;
            const totalNJOP = buildingNJOP + landNJOP;

            // --- 6. Hitung adjusted rate (untuk info)
            const baseRate = 2_000_000;
            const adjustedRate = baseRate * (1 + qualityBonus);

            // --- 7. Hitung NJKP dan PBB
            const njoptkp = 15_000_000;
            const njkpRate = totalNJOP < 1_000_000_000 ? 0.20 : 0.40;
            const njkp = njkpRate * Math.max(0, totalNJOP - njoptkp);
            const pbbDue = 0.005 * njkp;

            // --- 8. Simpan info untuk UI
            setBuildingInfo({
              uid,
              buildingId,
              windowCount,
              qualityBonus: (qualityBonus * 100).toFixed(0),
              adjustedRate,
              buildingNJOP,
              landNJOP,
              totalNJOP,
              njkpRate: (njkpRate * 100).toFixed(0),
              njkp,
              pbbDue,
            });

            console.log("📌 Building clicked:", {
              uid,
              buildingId,
              footprintArea,
              totalCount,
            });
          } catch (err) {
            console.error("❌ Gagal mengambil data bangunan:", err);
          }
        }, ScreenSpaceEventType.LEFT_CLICK);
      })
      .catch((error) => {
        console.error("Error loading GeoJSON:", error);
      });

    return () => {
      if (clickHandler) clickHandler.destroy();
      if (viewer && !viewer.isDestroyed()) viewer.destroy();
    };
  }, [navigate]);

  return (
    <div style={{ position: "relative" }}>
      <div ref={viewerRef} style={{ width: "100%", height: "100vh" }} />
      {buildingInfo && (
        <div
          style={{
            position: "absolute",
            top: 0,
            right: 0,
            width: "320px",
            height: "100vh",
            background: "#f5f5f5",
            borderLeft: "1px solid #ccc",
            padding: "16px",
            overflowY: "auto",
            zIndex: 1000,
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            {buildingInfo.windowCount === 0 && (
              <p style={{ color: "gray" }}>No windows found for this building.</p>
            )}

            <button
              onClick={() => setBuildingInfo(null)}
              style={{
                background: "none",
                border: "none",
                fontSize: "20px",
                cursor: "pointer",
                color: "#999",
              }}
              title="Close"
            >
              ×
            </button>
          </div>

          <p><strong>ID Bangunan:</strong> {buildingInfo.buildingId || "N/A"}</p>
          <p><strong>Jumlah Jendela:</strong> {buildingInfo.windowCount ?? "N/A"}</p>
          <p><strong>Bonus Kualitas:</strong> +{buildingInfo.qualityBonus ?? "0"}%</p>
          <p><strong>Tarif Terkoreksi:</strong> {formatRupiah(buildingInfo.adjustedRate)} /m²</p>
          <p><strong>NJOP Bangunan:</strong> {formatRupiah(buildingInfo.buildingNJOP)}</p>
          <p><strong>NJOP Tanah:</strong> {formatRupiah(buildingInfo.landNJOP)}</p>
          <p><strong>Total NJOP:</strong> {formatRupiah(buildingInfo.totalNJOP)}</p>
          <p>
            <strong>NJKP ({buildingInfo.njkpRate ?? "N/A"}%):</strong>{" "}
            {formatRupiah(buildingInfo.njkp)}
          </p>
          <p><strong>Estimasi PBB (0.5%):</strong> {formatRupiah(buildingInfo.pbbDue)}</p>


          <button
            style={{
              marginTop: "10px",
              padding: "8px 16px",
              backgroundColor: "#007bff",
              color: "#fff",
              border: "none",
              borderRadius: "4px",
              cursor: "pointer",
            }}
            onClick={() => navigate(`/zoom/${buildingInfo.uid}`)}
          >
            Zoom In
          </button>
        </div>
      )}
    </div>
  );
};

export default CesiumViewer;