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
const BASE_Z = 3;
const Z_GAP = 2;
const XY_GAP = 2;
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

        let hpr = new HeadingPitchRoll(0, 0, 0);
        if (orientation) {
          const omegaRad = CesiumMath.toRadians(orientation.omega || 0);
          const phiRad = CesiumMath.toRadians(orientation.phi || 0);
          const kappaRad = CesiumMath.toRadians(orientation.kappa || 0);
          hpr = new HeadingPitchRoll(kappaRad, phiRad, omegaRad);
        }

        const xOffset = startX + widths.slice(0, i).reduce((sum, w) => sum + w + XY_GAP, 0) + width / 2;
        const zOffset = currentZ + height / 2;

        const position = Cartesian3.fromDegrees(avgLon, avgLat, zOffset);
        const baseMatrix = Transforms.headingPitchRollToFixedFrame(position, hpr);
        const layoutShift = Matrix4.fromTranslation(new Cartesian3(xOffset, 0, 0));
        const forwardLocal = Cartesian3.negate(Cartesian3.UNIT_Z, new Cartesian3());
        const forwardWorld = Matrix4.multiplyByPointAsVector(baseMatrix, forwardLocal, new Cartesian3());
        Cartesian3.normalize(forwardWorld, forwardWorld);
        const forwardShift = Matrix4.fromTranslation(Cartesian3.multiplyByScalar(forwardWorld, FORWARD_DISTANCE, new Cartesian3()));
        const withLayout = Matrix4.multiply(baseMatrix, layoutShift, new Matrix4());
        const modelMatrix = Matrix4.multiply(withLayout, forwardShift, new Matrix4());

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

      // Update Z level for next row
      const maxHeightInRow = Math.max(...row.items.map(f => (f.properties?.heightInMeters || 1) * SCALE_FACTOR));
      currentZ += maxHeightInRow + Z_GAP;
    }

    viewer.scene.requestRender();
    console.log(`✅ Placed ${count} windows using center-aligned row layout.`);
  } catch (err) {
    console.error("❌ Failed to place windows:", err);
  }
};
