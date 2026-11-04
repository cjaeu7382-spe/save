(function (global) {
  "use strict";

  function writeU16(bytes, value) {
    bytes.push(value & 255, (value >> 8) & 255);
  }

  function medianCutPalette(pixels, maxColors) {
    if (!pixels.length) {
      const fallback = [];
      for (let i = 0; i < maxColors; i++) fallback.push([0, 0, 0]);
      return fallback;
    }

    const boxes = [{ pixels: pixels, rMin: 255, rMax: 0, gMin: 255, gMax: 0, bMin: 255, bMax: 0 }];

    function bounds(box) {
      let rMin = 255,
        rMax = 0,
        gMin = 255,
        gMax = 0,
        bMin = 255,
        bMax = 0;
      const pts = box.pixels;
      for (let i = 0; i < pts.length; i += 3) {
        const r = pts[i],
          g = pts[i + 1],
          b = pts[i + 2];
        if (r < rMin) rMin = r;
        if (r > rMax) rMax = r;
        if (g < gMin) gMin = g;
        if (g > gMax) gMax = g;
        if (b < bMin) bMin = b;
        if (b > bMax) bMax = b;
      }
      box.rMin = rMin;
      box.rMax = rMax;
      box.gMin = gMin;
      box.gMax = gMax;
      box.bMin = bMin;
      box.bMax = bMax;
    }

    bounds(boxes[0]);

    while (boxes.length < maxColors) {
      let longest = 0;
      let idx = 0;
      for (let i = 0; i < boxes.length; i++) {
        const box = boxes[i];
        const range = Math.max(box.rMax - box.rMin, box.gMax - box.gMin, box.bMax - box.bMin);
        if (range > longest && box.pixels.length > 3) {
          longest = range;
          idx = i;
        }
      }
      if (longest === 0) break;

      const box = boxes[idx];
      const rRange = box.rMax - box.rMin;
      const gRange = box.gMax - box.gMin;
      const bRange = box.bMax - box.bMin;
      let channel = 0;
      if (gRange >= rRange && gRange >= bRange) channel = 1;
      else if (bRange >= rRange && bRange >= gRange) channel = 2;

      const pts = box.pixels;
      const colors = [];
      for (let i = 0; i < pts.length; i += 3) colors.push([pts[i], pts[i + 1], pts[i + 2]]);
      colors.sort(function (a, b) {
        return a[channel] - b[channel];
      });
      const mid = Math.max(1, Math.floor(colors.length / 2));
      const left = [];
      const right = [];
      for (let i = 0; i < colors.length; i++) {
        const dest = i < mid ? left : right;
        dest.push(colors[i][0], colors[i][1], colors[i][2]);
      }
      if (!left.length || !right.length) break;

      const a = { pixels: left };
      const b = { pixels: right };
      bounds(a);
      bounds(b);
      boxes.splice(idx, 1, a, b);
    }

    const palette = [];
    for (let i = 0; i < boxes.length; i++) {
      const pts = boxes[i].pixels;
      let r = 0,
        g = 0,
        b = 0,
        n = pts.length / 3;
      for (let p = 0; p < pts.length; p += 3) {
        r += pts[p];
        g += pts[p + 1];
        b += pts[p + 2];
      }
      palette.push([Math.round(r / n), Math.round(g / n), Math.round(b / n)]);
    }
    while (palette.length < maxColors) palette.push([0, 0, 0]);
    return palette;
  }

  function nearestIndex(palette, r, g, b) {
    let best = 0;
    let bestDist = Infinity;
    for (let i = 0; i < palette.length; i++) {
      const pr = palette[i][0] - r;
      const pg = palette[i][1] - g;
      const pb = palette[i][2] - b;
      const dist = pr * pr + pg * pg + pb * pb;
      if (dist < bestDist) {
        bestDist = dist;
        best = i;
        if (dist === 0) break;
      }
    }
    return best;
  }

  function mapPixels(imageData, palette, dither) {
    const { data, width, height } = imageData;
    const indexes = new Uint8Array(width * height);
    const cache = dither ? null : new Int16Array(32768);
    if (cache) cache.fill(-1);
    const work = dither ? new Float32Array(data.length) : null;
    if (dither) {
      for (let i = 0; i < data.length; i++) work[i] = data[i];
    }

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const i = (y * width + x) * 4;
        const r = dither ? clamp(work[i]) : data[i];
        const g = dither ? clamp(work[i + 1]) : data[i + 1];
        const b = dither ? clamp(work[i + 2]) : data[i + 2];
        let idx;
        if (cache) {
          const key = ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3);
          idx = cache[key];
          if (idx < 0) {
            idx = nearestIndex(palette, r, g, b);
            cache[key] = idx;
          }
        } else {
          idx = nearestIndex(palette, r, g, b);
        }
        indexes[y * width + x] = idx;
        if (!dither) continue;
        const pr = palette[idx][0];
        const pg = palette[idx][1];
        const pb = palette[idx][2];
        const er = r - pr;
        const eg = g - pg;
        const eb = b - pb;
        spread(work, width, height, x + 1, y, er, eg, eb, 7 / 16);
        spread(work, width, height, x - 1, y + 1, er, eg, eb, 3 / 16);
        spread(work, width, height, x, y + 1, er, eg, eb, 5 / 16);
        spread(work, width, height, x + 1, y + 1, er, eg, eb, 1 / 16);
      }
    }
    return indexes;
  }

  function clamp(v) {
    return v < 0 ? 0 : v > 255 ? 255 : v;
  }

  function spread(buf, w, h, x, y, er, eg, eb, factor) {
    if (x < 0 || y < 0 || x >= w || y >= h) return;
    const i = (y * w + x) * 4;
    buf[i] += er * factor;
    buf[i + 1] += eg * factor;
    buf[i + 2] += eb * factor;
  }

  // GIF LZW from the classic compress.c / gifenc path used by working GIF encoders.
  function lzwEncode(pixels, colorDepth) {
    const BITS = 12;
    const HSIZE = 5003;
    const MASKS = [
      0x0000, 0x0001, 0x0003, 0x0007, 0x000f, 0x001f, 0x003f, 0x007f, 0x00ff, 0x01ff, 0x03ff, 0x07ff, 0x0fff, 0x1fff,
      0x3fff, 0x7fff, 0xffff,
    ];

    const out = [];
    const accum = new Uint8Array(256);
    const htab = new Int32Array(HSIZE);
    const codetab = new Int32Array(HSIZE);
    htab.fill(-1);

    const initCodeSize = Math.max(2, colorDepth);
    out.push(initCodeSize);

    let curAccum = 0;
    let curBits = 0;
    let aCount = 0;
    const initBits = initCodeSize + 1;
    let clearFlag = false;
    let nBits = initBits;
    let maxcode = (1 << nBits) - 1;
    const clearCode = 1 << (initBits - 1);
    const eofCode = clearCode + 1;
    let freeEnt = clearCode + 2;

    function charOut(c) {
      accum[aCount++] = c;
      if (aCount >= 254) flushChar();
    }

    function flushChar() {
      if (aCount > 0) {
        out.push(aCount);
        for (let i = 0; i < aCount; i++) out.push(accum[i]);
        aCount = 0;
      }
    }

    function output(code) {
      curAccum &= MASKS[curBits];
      if (curBits > 0) curAccum |= code << curBits;
      else curAccum = code;
      curBits += nBits;

      while (curBits >= 8) {
        charOut(curAccum & 0xff);
        curAccum >>= 8;
        curBits -= 8;
      }

      if (freeEnt > maxcode || clearFlag) {
        if (clearFlag) {
          nBits = initBits;
          maxcode = (1 << nBits) - 1;
          clearFlag = false;
        } else {
          nBits += 1;
          maxcode = nBits === BITS ? 1 << nBits : (1 << nBits) - 1;
        }
      }

      if (code === eofCode) {
        while (curBits > 0) {
          charOut(curAccum & 0xff);
          curAccum >>= 8;
          curBits -= 8;
        }
        flushChar();
      }
    }

    let hshift = 0;
    for (let fcode = HSIZE; fcode < 65536; fcode *= 2) hshift += 1;
    hshift = 8 - hshift;

    output(clearCode);
    let ent = pixels[0];

    for (let idx = 1; idx < pixels.length; idx++) {
      const c = pixels[idx];
      const fcode = (c << BITS) + ent;
      let i = (c << hshift) ^ ent;
      let found = false;

      if (htab[i] === fcode) {
        ent = codetab[i];
        continue;
      }

      const disp = i === 0 ? 1 : HSIZE - i;
      while (htab[i] >= 0) {
        i -= disp;
        if (i < 0) i += HSIZE;
        if (htab[i] === fcode) {
          ent = codetab[i];
          found = true;
          break;
        }
      }
      if (found) continue;

      output(ent);
      ent = c;
      if (freeEnt < 1 << BITS) {
        codetab[i] = freeEnt;
        htab[i] = fcode;
        freeEnt += 1;
      } else {
        htab.fill(-1);
        freeEnt = clearCode + 2;
        clearFlag = true;
        output(clearCode);
      }
    }

    output(ent);
    output(eofCode);
    out.push(0);
    return out;
  }

  function samplePixels(imageDatas, limit) {
    const collected = [];
    const step = Math.max(1, Math.floor((imageDatas[0].width * imageDatas[0].height) / 8000));
    for (let f = 0; f < imageDatas.length; f++) {
      const data = imageDatas[f].data;
      for (let i = 0; i < data.length; i += 4 * step) {
        collected.push(data[i], data[i + 1], data[i + 2]);
        if (collected.length / 3 > limit) return collected;
      }
    }
    return collected;
  }

  async function encodeGif(frames, options, onProgress) {
    const width = options.width;
    const height = options.height;
    const delay = Math.max(2, Math.round((options.delay || 100) / 10));
    const loop = options.loop;
    const paletteSize = 256;
    const colorBits = 8;

    const samples = samplePixels(frames, 40000);
    const palette = medianCutPalette(samples, paletteSize);

    const bytes = [];
    bytes.push(71, 73, 70, 56, 57, 97);
    writeU16(bytes, width);
    writeU16(bytes, height);
    bytes.push(0xf7, 0, 0);
    for (let i = 0; i < paletteSize; i++) {
      const c = palette[i] || [0, 0, 0];
      bytes.push(c[0], c[1], c[2]);
    }

    bytes.push(0x21, 0xff, 11);
    const netscape = "NETSCAPE2.0";
    for (let i = 0; i < netscape.length; i++) bytes.push(netscape.charCodeAt(i));
    bytes.push(3, 1);
    writeU16(bytes, loop);
    bytes.push(0);

    for (let f = 0; f < frames.length; f++) {
      const indexes = mapPixels(frames[f], palette, options.dither);
      // Disposal 1 (do not dispose): each frame is a full image.
      bytes.push(0x21, 0xf9, 4, 0x04, delay & 255, (delay >> 8) & 255, 0, 0);
      bytes.push(0x2c);
      writeU16(bytes, 0);
      writeU16(bytes, 0);
      writeU16(bytes, width);
      writeU16(bytes, height);
      bytes.push(0);
      const compressed = lzwEncode(indexes, colorBits);
      for (let i = 0; i < compressed.length; i++) bytes.push(compressed[i]);
      if (onProgress) onProgress((f + 1) / frames.length);
      await new Promise(function (resolve) {
        setTimeout(resolve, 0);
      });
    }

    bytes.push(0x3b);
    return new Blob([new Uint8Array(bytes)], { type: "image/gif" });
  }

  global.GifLab = { encodeGif };
})(window);
