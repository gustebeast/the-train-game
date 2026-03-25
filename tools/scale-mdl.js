// Scale an MDL model file by a given factor
// Usage: node scale-mdl.js <input.mdl> <output.mdl> <scale>
// Scales: vertex positions, extents, bounds radii, pivot points,
// bone/helper/attachment translations, particle emitter dimensions

const fs = require("fs");

const [inputPath, outputPath, scaleStr] = process.argv.slice(2);
if (!inputPath || !outputPath || !scaleStr) {
  console.error("Usage: node scale-mdl.js <input.mdl> <output.mdl> <scale>");
  process.exit(1);
}

const scale = parseFloat(scaleStr);
const content = fs.readFileSync(inputPath, "utf-8");

// Scale a single float string, preserving sign and reasonable precision
function scaleNum(match) {
  const val = parseFloat(match);
  const scaled = val * scale;
  // Preserve reasonable precision
  if (Math.abs(scaled) < 0.0001 && scaled !== 0) {
    return scaled.toExponential();
  }
  // Use enough decimal places
  const result = scaled.toPrecision(6);
  // Remove trailing zeros after decimal point but keep at least one
  return parseFloat(result).toString();
}

// Scale a { x, y, z } vector
function scaleVector(match) {
  return match.replace(/-?\d+\.?\d*(?:[eE][+-]?\d+)?/g, scaleNum);
}

let output = content;

// 1. Scale MinimumExtent { x, y, z } and MaximumExtent { x, y, z }
output = output.replace(/(MinimumExtent|MaximumExtent)\s*\{[^}]+\}/g, (match) => {
  const prefix = match.match(/(MinimumExtent|MaximumExtent)\s*\{/)[0];
  const suffix = "}";
  const inner = match.slice(prefix.length, -1);
  const scaled = inner.replace(/-?\d+\.?\d*(?:[eE][+-]?\d+)?/g, scaleNum);
  return prefix + scaled + suffix;
});

// 2. Scale BoundsRadius value
output = output.replace(/BoundsRadius\s+(-?\d+\.?\d*(?:[eE][+-]?\d+)?)/g, (match, num) => {
  return "BoundsRadius " + scaleNum(num);
});

// 3. Scale vertex positions in Vertices blocks (but NOT TVertices)
// Use negative lookbehind to exclude TVertices
output = output.replace(/((?<!T)Vertices\s+\d+\s*\{)([\s\S]*?)(\n\t\})/g, (match, header, body, footer) => {
  const scaledBody = body.replace(/\{([^}]+)\}/g, (vecMatch) => {
    return scaleVector(vecMatch);
  });
  return header + scaledBody + footer;
});

// 4. Scale PivotPoints
output = output.replace(/(PivotPoints\s+\d+\s*\{)([\s\S]*?)(\n\})/g, (match, header, body, footer) => {
  const scaledBody = body.replace(/\{([^}]+)\}/g, (vecMatch) => {
    return scaleVector(vecMatch);
  });
  return header + scaledBody + footer;
});

// 5. Scale Translation keys in bones/helpers/attachments
// Translation { x, y, z } static or keyframed
output = output.replace(/static Translation\s*\{([^}]+)\}/g, (match) => {
  return scaleVector(match);
});

// Keyframed translations: lines like "  <time>: { x, y, z },"
// These appear inside Translation blocks
output = output.replace(/(Translation\s+\d+\s*\{[\s\S]*?)((?:\n\t\t\d+:\s*\{[^}]+\},?[\s\S]*?)*?)(\n\t\})/g, (match, header, body, footer) => {
  if (!body) return match;
  const scaledBody = body.replace(/(\d+:\s*)\{([^}]+)\}/g, (kfMatch, prefix, coords) => {
    const scaled = coords.replace(/-?\d+\.?\d*(?:[eE][+-]?\d+)?/g, scaleNum);
    return prefix + "{" + scaled + "}";
  });
  return header + scaledBody + footer;
});

// 6. Scale particle emitter spatial properties
// Width, Length, Speed, Latitude, Variation, Gravity might need scaling
// Only Width and Length are spatial; Speed and Gravity are debatable
const particleSpatialProps = ["Width", "Length", "Speed", "Gravity"];
for (const prop of particleSpatialProps) {
  const re = new RegExp(`(static\\s+${prop}\\s+)(-?\\d+\\.?\\d*(?:[eE][+-]?\\d+)?)`, "g");
  output = output.replace(re, (match, prefix, num) => {
    return prefix + scaleNum(num);
  });
  // Also handle keyframed versions
  const reKeyed = new RegExp(`(${prop}\\s+\\d+\\s*\\{[\\s\\S]*?)((?:\\n\\t\\t\\d+:\\s*-?\\d+\\.?\\d*(?:[eE][+-]?\\d+)?,?[\\s\\S]*?)*?)(\\n\\t\\})`, "g");
  output = output.replace(reKeyed, (match, header, body, footer) => {
    if (!body) return match;
    const scaledBody = body.replace(/(\d+:\s*)(-?\d+\.?\d*(?:[eE][+-]?\d+)?)/g, (kfMatch, prefix, num) => {
      return prefix + scaleNum(num);
    });
    return header + scaledBody + footer;
  });
}

// 7. Scale ParticleScaling {x, y, z} values
output = output.replace(/(ParticleScaling\s*\{)([^}]+)(\})/g, (match, prefix, inner, suffix) => {
  const scaled = inner.replace(/-?\d+\.?\d*(?:[eE][+-]?\d+)?/g, scaleNum);
  return prefix + scaled + suffix;
});

// 8. Scale Light attenuation
output = output.replace(/(static\s+AttenuationStart\s+)(-?\d+\.?\d*(?:[eE][+-]?\d+)?)/g, (m, p, n) => p + scaleNum(n));
output = output.replace(/(static\s+AttenuationEnd\s+)(-?\d+\.?\d*(?:[eE][+-]?\d+)?)/g, (m, p, n) => p + scaleNum(n));

fs.writeFileSync(outputPath, output, "utf-8");
console.log(`Scaled ${inputPath} by ${scale} -> ${outputPath}`);
