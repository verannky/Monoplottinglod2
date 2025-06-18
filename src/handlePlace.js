import {
  Cartesian3,
  BoxGeometry,
  GeometryInstance,
  ColorGeometryInstanceAttribute,
  Primitive,
  VertexFormat,
  PerInstanceColorAppearance,
  Color,
  HeadingPitchRoll,
  Transforms,
  Matrix4,
  Math as CesiumMath
} from "cesium";

// Constants
const FIXED_DEPTH = 0.3;
const SCALE_FACTOR = 2000;
const BASE_Z = 0.2;
const XY_GAP = 1;
const FORWARD_DISTANCE = 0.001;
const ROW_THRESHOLD = 0.000000008; // Small difference to detect different rows

const loadReferenceMap = async () => {
  const response = await fetch("/reference_lab.txt");
  const text = await response.text();
  const lines = text.split("\n").filter(l => l.trim() && !l.startsWith("#"));
  const refMap = {};
  for (const line of lines) {
    const parts = line.split(",");
    const filename = parts[0]?.trim();
    const lon = parseFloat(parts[1]);
    const lat = parseFloat(parts[2]);
    const alt = parseFloat(parts[3]);
    const omega = parseFloat(parts[4]);
    const phi = parseFloat(parts[5]);
    const kappa = parseFloat(parts[6]);
    refMap[filename] = { lon, lat, alt, omega, phi, kappa };
  }
  return refMap;
};

const loadWallPolygons = async (uid) => {
  const response = await fetch("/building_with_parts.geojson");
  const data = await response.json();
  const building = data.features.find(f =>
    f.properties?.uid === uid && f.geometry?.type === "MultiPolygon"
  );
  if (!building) return [];

  const walls = [];
  for (const surface of building.geometry.coordinates) {
    for (const ring of surface) {
      const isWall = ring.some(([_, __, z]) => z === 0);
      if (!isWall) continue;
      const coords2D = ring.map(([lon, lat]) => [lon, lat]);
      const center = coords2D.reduce(([sx, sy], [x, y]) => [sx + x, sy + y], [0, 0])
        .map(v => v / coords2D.length);
      walls.push({
        coords2D,
        center,
        side: walls.length + 1 // side index starts at 1
      });
    }
  }
  return walls;
};

const computeHeadingFromWall = (wall) => {
  const coords = wall.coords2D;
  if (coords.length < 2) return 0;

  let maxLength = 0;
  let bestHeading = 0;

  for (let i = 0; i < coords.length - 1; i++) {
    const [p1, p2] = [coords[i], coords[i + 1]];
    const dx = p2[0] - p1[0];
    const dy = p2[1] - p1[1];
    const length = dx * dx + dy * dy;

    if (length > maxLength) {
      maxLength = length;
      bestHeading = Math.atan2(dy, dx) + Math.PI / 2;
    }
  }

  return bestHeading;
};

const distanceSquared = (a, b) => {
  const dx = a[0] - b[0];
  const dy = a[1] - b[1];
  return dx * dx + dy * dy;
};

export const handlePlace = async (viewer, annotationUrl, uid) => {
  if (!viewer) return console.error("❌ Viewer not ready");

  try {
    const response = await fetch(annotationUrl);
    const geojson = await response.json();
    let features = geojson.features || [];

    if (!features.length) {
      console.warn("⚠️ No features in GeoJSON.");
      return;
    }

    const refMap = await loadReferenceMap();
    const wallPolygons = await loadWallPolygons(uid);

    // Compute average lon/lat for each feature
    features = features.map(f => {
      const coords = f.geometry?.coordinates?.[0];
      const avgLon = coords.reduce((sum, c) => sum + c[0], 0) / coords.length;
      const avgLat = coords.reduce((sum, c) => sum + c[1], 0) / coords.length;
      return { ...f, _avgLon: avgLon, _avgLat: avgLat };
    });

    // Group into rows based on latitude
    features.sort((a, b) => a._avgLat - b._avgLat);
    let rowGroups = [];
    for (const feature of features) {
      const lat = feature._avgLat;
      let found = false;
      for (const row of rowGroups) {
        if (Math.abs(row.key - lat) < ROW_THRESHOLD) {
          row.items.push(feature);
          found = true;
          break;
        }
      }
      if (!found) rowGroups.push({ key: lat, items: [feature] });
    }

    // Sort items in each row by longitude
    for (const row of rowGroups) {
      row.items.sort((a, b) => a._avgLon - b._avgLon);
    }

    // Place each row
    let currentZ = BASE_Z;
    let count = 0;

    for (let rowIdx = 0; rowIdx < rowGroups.length; rowIdx++) {
      const row = rowGroups[rowIdx];
      const widths = row.items.map(f => (f.properties?.widthInMeters || 1) * SCALE_FACTOR);
      const totalWidth = widths.reduce((sum, w) => sum + w + XY_GAP, -XY_GAP);
      const startX = -totalWidth / 2;

      for (let i = 0; i < row.items.length; i++) {
        const feature = row.items[i];
        const coords = feature.geometry?.coordinates?.[0];
        const props = feature.properties || {};
        if (!coords || coords.length < 1) continue;

        const avgLon = feature._avgLon;
        const avgLat = feature._avgLat;
        const width = widths[i];
        const height = (props.heightInMeters || 1) * SCALE_FACTOR;
        const imageName = props.imageName?.trim();
        const orientation = refMap[imageName];


        let hpr;
        let nearest = null; // ✅ Declare it outside the block

        if (wallPolygons.length) {
          const fCoord = [avgLon, avgLat];
          nearest = wallPolygons[0];
          let minDist = distanceSquared(fCoord, nearest.center);
          for (const wall of wallPolygons) {
            const dist = distanceSquared(fCoord, wall.center);
            if (dist < minDist) {
              nearest = wall;
              minDist = dist;
            }
          }
          console.log(`📌 Object at (${avgLon.toFixed(6)}, ${avgLat.toFixed(6)}) placed on Side ${nearest.side}`);
          
          const heading = computeHeadingFromWall(nearest);
          const headingOffset = CesiumMath.toRadians(-13); // ✅ Apply here
          hpr = new HeadingPitchRoll(heading + headingOffset, 0, 0); // ✅ corrected
        } else if (orientation) {
          const omegaRad = CesiumMath.toRadians(orientation.omega || 0);
          const phiRad = CesiumMath.toRadians(orientation.phi || 0);
          const kappaRad = CesiumMath.toRadians(orientation.kappa || 0);
          hpr = new HeadingPitchRoll(kappaRad, phiRad, omegaRad);
        } else {
          hpr = new HeadingPitchRoll(0, 0, 0);
        }

        const xOffset = startX + widths.slice(0, i).reduce((sum, w) => sum + w + XY_GAP, 0) + width / 2;
        const zOffset = currentZ + height / 2;

        const wallLon = nearest.center[0];
        const wallLat = nearest.center[1];
        const wallAnchor = Cartesian3.fromDegrees(wallLon, wallLat, zOffset);
        const baseMatrix = Transforms.headingPitchRollToFixedFrame(wallAnchor, hpr);

        const layoutShift = Matrix4.fromTranslation(new Cartesian3(xOffset, 0, 0));
        // Shift inward (flush against the wall)
        // Shift toward wall based on heading (wall normal)
        const pushDistance = -(width / 2 + 0.9); // object width / 2 + buffer
        const dx = Math.cos(hpr.heading);
        const dy = Math.sin(hpr.heading);
        const pushVector = new Cartesian3(dx * pushDistance, dy * pushDistance, 0);

        // Rotate pushVector into world space
        const modelMatrix = Matrix4.multiply(baseMatrix, layoutShift, new Matrix4());
        const box = new BoxGeometry({
          vertexFormat: VertexFormat.ALL,
          maximum: new Cartesian3(width / 2, FIXED_DEPTH / 2, height / 2),
          minimum: new Cartesian3(-width / 2, -FIXED_DEPTH / 2, -height / 2)
        });

        const instance = new GeometryInstance({
          geometry: box,
          modelMatrix,
          attributes: {
            color: ColorGeometryInstanceAttribute.fromColor(Color.LIME.withAlpha(0.85))
          }
        });

        viewer.scene.primitives.add(
          new Primitive({
            geometryInstances: instance,
            appearance: new PerInstanceColorAppearance({ translucent: true }),
            asynchronous: false
          })
        );

        count++;
      }

      // Helper to extract min/max Z from polygon
      const getFeatureZRange = (feature) => {
        const coords = feature.geometry?.coordinates?.[0] || [];
        const zs = coords.map(pt => pt[2] || feature.properties?.altitude || 0);
        return {
          minZ: Math.min(...zs),
          maxZ: Math.max(...zs)
        };
      };

      // Compute current row's max Z
      const zRanges = row.items.map(getFeatureZRange);
      const currentMaxZ = Math.max(...zRanges.map(r => r.maxZ));
      const SCALE_FACTORZ=1000

      // Only compute Z_GAP if next row exists
      if (rowIdx < rowGroups.length - 1) {
        const nextRow = rowGroups[rowIdx + 1];
        const nextZRanges = nextRow.items.map(getFeatureZRange);
        const nextMinZ = Math.min(...nextZRanges.map(r => r.minZ));

        const dynamicZGap = nextMinZ - currentMaxZ;

        console.log(`📏 Dynamic Z_GAP from row ${rowIdx} to ${rowIdx + 1}: ${dynamicZGap.toFixed(6)} meters`);

        // Apply gap (fall back to small offset if negative or too small)
        currentZ += Math.max(dynamicZGap, 0.003 * SCALE_FACTORZ); // 5 units fallback
      }

    }

    viewer.scene.requestRender();
    console.log(`✅ Placed ${count} windows using center-aligned row layout.`);
  } catch (err) {
    console.error("❌ Failed to place windows:", err);
  }
};
