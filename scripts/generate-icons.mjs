import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const OUTPUT_DIR = path.resolve(process.cwd(), 'public', 'icons');

const ICONS = [
  { filename: 'icon-192.png', size: 192, emblemScale: 0.88, oversample: 2 },
  { filename: 'icon-512.png', size: 512, emblemScale: 0.88, oversample: 2 },
  { filename: 'icon-maskable-512.png', size: 512, emblemScale: 0.64, oversample: 2 },
  { filename: 'apple-touch-icon-180.png', size: 180, emblemScale: 0.84, oversample: 2 },
  { filename: 'favicon-32.png', size: 32, emblemScale: 0.94, oversample: 4 },
];

// Build CRC32 lookup table for PNG chunk checksums
const CRC_TABLE = new Uint32Array(256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) {
    c = (c & 1) !== 0 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  }
  CRC_TABLE[n] = c >>> 0;
}

function crc32(buffer) {
  let crc = 0xffffffff;
  for (let i = 0; i < buffer.length; i++) {
    crc = CRC_TABLE[(crc ^ buffer[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function makeChunk(type, data) {
  const typeBytes = Buffer.from(type, 'ascii');
  const lenBytes = Buffer.allocUnsafe(4);
  lenBytes.writeUInt32BE(data.length, 0);

  const crcInput = Buffer.concat([typeBytes, data]);
  const crcBytes = Buffer.allocUnsafe(4);
  crcBytes.writeUInt32BE(crc32(crcInput), 0);

  return Buffer.concat([lenBytes, typeBytes, data, crcBytes]);
}

function encodePng(width, height, rgba) {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

  const ihdr = Buffer.allocUnsafe(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // interlace

  const stride = width * 4;
  const raw = Buffer.allocUnsafe((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    const rowStart = y * (stride + 1);
    raw[rowStart] = 0; // filter type 0 (None)
    rgba.copy(raw, rowStart + 1, y * stride, (y + 1) * stride);
  }

  const compressed = zlib.deflateSync(raw, { level: 9 });

  return Buffer.concat([
    signature,
    makeChunk('IHDR', ihdr),
    makeChunk('IDAT', compressed),
    makeChunk('IEND', Buffer.alloc(0)),
  ]);
}

function clamp01(v) {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

function smoothstep(edge0, edge1, x) {
  const t = clamp01((x - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
}

function mix(a, b, t) {
  return a + (b - a) * t;
}

function blendColor(dst, r, g, b, alpha) {
  const a = clamp01(alpha);
  dst[0] = mix(dst[0], r, a);
  dst[1] = mix(dst[1], g, a);
  dst[2] = mix(dst[2], b, a);
}

function sampleEmblem(nx, ny, emblemScale, pixelWidth) {
  const aa = pixelWidth * 1.15;

  // Midnight enamel background (#0B1020) with subtle horological radial sheen
  const bgDist = Math.hypot(nx, ny);
  const bgGlow = Math.exp(-bgDist * bgDist * 2.2);
  const out = [
    mix(8, 20, bgGlow),
    mix(12, 31, bgGlow),
    mix(25, 62, bgGlow),
  ];

  // Scale into emblem space
  const x = nx / emblemScale;
  const y = ny / emblemScale;
  const r = Math.hypot(x, y);
  const angle = Math.atan2(y, x);
  const lightDot = clamp01((-x * 0.65 - y * 0.76) * 0.7 + 0.5);

  // Subtle outer dial ring & 12 chapter ticks
  const outerRingDist = Math.abs(r - 0.89) - 0.011;
  const outerRingAlpha = 1 - smoothstep(-aa, aa, outerRingDist);
  if (outerRingAlpha > 0) {
    blendColor(out, 245, 197, 66, outerRingAlpha * 0.35);
  }

  // 12 major brass ticks + 48 subtle blued-steel minor ticks
  const tickSector48 = Math.abs(Math.sin(angle * 24));
  const isMajorTick = Math.abs(Math.sin(angle * 6)) < 0.08;
  const tickBand = smoothstep(0.77, 0.785, r) * (1 - smoothstep(0.84, 0.855, r));
  if (tickBand > 0) {
    const minorHit = 1 - smoothstep(0.03, 0.09, tickSector48);
    if (minorHit > 0) {
      if (isMajorTick) {
        blendColor(out, 245, 197, 66, tickBand * minorHit * 0.65);
      } else {
        blendColor(out, 76, 201, 240, tickBand * minorHit * 0.32);
      }
    }
  }

  // 12-tooth golden brass gear (#F5C542)
  const toothWave = Math.cos(angle * 12);
  const toothProfile = smoothstep(-0.22, 0.28, toothWave);
  const gearOuterR = 0.61 + 0.115 * toothProfile;
  const gearInnerR = 0.48;

  // Drop shadow under gear
  const shadowR = Math.hypot(x - 0.015, y - 0.028);
  const shadowAngle = Math.atan2(y - 0.028, x - 0.015);
  const shadowTooth = smoothstep(-0.22, 0.28, Math.cos(shadowAngle * 12));
  const shadowOuter = 0.61 + 0.115 * shadowTooth;
  const gearShadow = 1 - smoothstep(-aa * 2, aa * 3, shadowR - shadowOuter);
  if (gearShadow > 0) {
    blendColor(out, 3, 5, 12, gearShadow * 0.55);
  }

  // Gear ring SDF
  const dGearOuter = r - gearOuterR;
  const dGearInner = gearInnerR - r;
  const dGear = Math.max(dGearOuter, dGearInner);
  const gearAlpha = 1 - smoothstep(-aa, aa, dGear);
  if (gearAlpha > 0) {
    // Metallic brass gradient with rim bevel
    const rimShade = smoothstep(0.49, 0.64, r);
    const bevel = smoothstep(0.03, 0.0, Math.abs(dGear));
    const brassR = mix(196, 255, lightDot * 0.72 + bevel * 0.25);
    const brassG = mix(142, 224, lightDot * 0.72 + bevel * 0.2);
    const brassB = mix(24, 110, lightDot * 0.6 + rimShade * 0.15);
    blendColor(out, brassR, brassG, brassB, gearAlpha);
  }

  // Recessed midnight dial cavity inside gear
  const cavityAlpha = 1 - smoothstep(-aa, aa, r - 0.48);
  if (cavityAlpha > 0) {
    const pit = mix(7, 15, smoothstep(0.0, 0.48, r));
    blendColor(out, pit, pit + 4, pit + 16, cavityAlpha);
  }

  // 4 diagonal brass escapement spokes (X-cross balance wheel spokes)
  const spokeRot = Math.PI / 4;
  const cs = Math.cos(spokeRot);
  const sn = Math.sin(spokeRot);
  const rx = x * cs - y * sn;
  const ry = x * sn + y * cs;
  const dSpokeH = Math.max(Math.abs(ry) - 0.032, Math.abs(rx) - 0.41, 0.19 - r);
  const dSpokeV = Math.max(Math.abs(rx) - 0.032, Math.abs(ry) - 0.41, 0.19 - r);
  const dSpokes = Math.min(dSpokeH, dSpokeV);
  const spokeAlpha = 1 - smoothstep(-aa, aa, dSpokes);
  if (spokeAlpha > 0) {
    const spR = mix(185, 250, lightDot);
    const spG = mix(132, 208, lightDot);
    const spB = mix(24, 78, lightDot);
    blendColor(out, spR, spG, spB, spokeAlpha);
  }

  // Blued-steel inner ring (#4CC9F0)
  const dBlued = Math.max(r - 0.425, 0.345 - r);
  const bluedAlpha = 1 - smoothstep(-aa, aa, dBlued);
  if (bluedAlpha > 0) {
    const ringCenter = 1 - smoothstep(0.0, 0.04, Math.abs(r - 0.385));
    const blR = mix(30, 145, lightDot * 0.65 + ringCenter * 0.35);
    const blG = mix(132, 232, lightDot * 0.6 + ringCenter * 0.35);
    const blB = mix(186, 255, lightDot * 0.45 + ringCenter * 0.4);
    blendColor(out, blR, blG, blB, bluedAlpha);
  }

  // Brass ruby-setting collet ring
  const dCollet = Math.max(r - 0.245, 0.18 - r);
  const colletAlpha = 1 - smoothstep(-aa, aa, dCollet);
  if (colletAlpha > 0) {
    const colR = mix(198, 255, lightDot * 0.8);
    const colG = mix(145, 224, lightDot * 0.8);
    const colB = mix(28, 118, lightDot * 0.6);
    blendColor(out, colR, colG, colB, colletAlpha);
  }

  // Soft ruby glow halo onto collet
  if (r < 0.32 && r > 0.16) {
    const halo = Math.exp(-Math.pow((r - 0.19) / 0.06, 2));
    blendColor(out, 255, 46, 99, halo * 0.22);
  }

  // Faceted ruby core (#FF2E63)
  const rubyAlpha = 1 - smoothstep(-aa, aa, r - 0.185);
  if (rubyAlpha > 0) {
    // 8-facet radial modulation + table facet
    const facetSector = Math.floor(((angle + Math.PI) / (Math.PI * 2)) * 8);
    const facetTone = (facetSector % 2 === 0 ? 0.08 : -0.06) + lightDot * 0.45;
    const isTable = r < 0.095;
    let rubR = isTable ? 255 : mix(172, 255, clamp01(0.45 + facetTone));
    let rubG = isTable ? 68 : mix(14, 92, clamp01(0.25 + facetTone));
    let rubB = isTable ? 118 : mix(56, 148, clamp01(0.35 + facetTone));

    // Upper-left crisp specular glint on jewel
    const specDist = Math.hypot(x + 0.055, y + 0.055);
    const spec = Math.exp(-specDist * specDist * 520);
    rubR = mix(rubR, 255, spec * 0.9);
    rubG = mix(rubG, 228, spec * 0.9);
    rubB = mix(rubB, 238, spec * 0.9);

    blendColor(out, rubR, rubG, rubB, rubyAlpha);
  }

  return out;
}

function renderIcon(size, emblemScale, oversample) {
  const rgba = Buffer.allocUnsafe(size * size * 4);
  const invHalf = 2 / size;
  const invSamples = 1 / (oversample * oversample);
  const pixelWidth = invHalf / emblemScale;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let accR = 0;
      let accG = 0;
      let accB = 0;

      for (let sy = 0; sy < oversample; sy++) {
        const py = y + (sy + 0.5) / oversample;
        const ny = py * invHalf - 1;
        for (let sx = 0; sx < oversample; sx++) {
          const px = x + (sx + 0.5) / oversample;
          const nx = px * invHalf - 1;
          const c = sampleEmblem(nx, ny, emblemScale, pixelWidth);
          accR += c[0];
          accG += c[1];
          accB += c[2];
        }
      }

      const idx = (y * size + x) * 4;
      rgba[idx] = Math.round(accR * invSamples);
      rgba[idx + 1] = Math.round(accG * invSamples);
      rgba[idx + 2] = Math.round(accB * invSamples);
      rgba[idx + 3] = 255;
    }
  }

  return encodePng(size, size, rgba);
}

function main() {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  for (const spec of ICONS) {
    const pngBuffer = renderIcon(spec.size, spec.emblemScale, spec.oversample);
    const targetPath = path.join(OUTPUT_DIR, spec.filename);
    fs.writeFileSync(targetPath, pngBuffer);
    console.log(`Generated ${path.relative(process.cwd(), targetPath)} (${pngBuffer.length} bytes)`);
  }
}

main();
