#!/usr/bin/env node
// Shrinks a big AI-drawn pixel-art picture to game size, keeping it crisp:
// each small pixel takes the most common colour of the area it covers
// (averaging would blur the edges). Used for the view outside the windows.
//
//   node tools/shrink-image.js in.png out.png --width 512 [--height 104] [--crop x,y,w,h]
//
// --crop picks the part of the big picture to use (in its own pixels).

import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { readPng, writePng } from './cut-sprites.js';

export function shrink(img, { width, height, crop = [0, 0, img.w, img.h] }) {
  const [cx, cy, cw, ch] = crop;
  height ||= Math.round((width * ch) / cw);
  const px = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      // The block of big pixels this small pixel stands for.
      const x0 = Math.floor(cx + (x * cw) / width);
      const x1 = Math.max(x0 + 1, Math.floor(cx + ((x + 1) * cw) / width));
      const y0 = Math.floor(cy + (y * ch) / height);
      const y1 = Math.max(y0 + 1, Math.floor(cy + ((y + 1) * ch) / height));
      const votes = new Map(); // colour (rounded a little, to forgive noise) -> how often
      let best = 0;
      let bestCount = 0;
      for (let yy = y0; yy < y1; yy++) {
        for (let xx = x0; xx < x1; xx++) {
          const i = (yy * img.w + xx) * 4;
          const colour = ((img.px[i] >> 3) << 10) | ((img.px[i + 1] >> 3) << 5) | (img.px[i + 2] >> 3);
          const count = (votes.get(colour) || 0) + 1;
          votes.set(colour, count);
          if (count > bestCount) {
            best = i;
            bestCount = count;
          }
        }
      }
      px.set([img.px[best], img.px[best + 1], img.px[best + 2], 255], (y * width + x) * 4);
    }
  }
  return { w: width, h: height, px };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      width: { type: 'string' },
      height: { type: 'string' },
      crop: { type: 'string' },
    },
  });
  const [input, output] = positionals;
  if (!input || !output || !values.width) {
    console.error('Usage: node tools/shrink-image.js in.png out.png --width 512 [--height 104] [--crop x,y,w,h]');
    process.exit(1);
  }
  const out = shrink(readPng(input), {
    width: Number(values.width),
    height: values.height ? Number(values.height) : undefined,
    crop: values.crop ? values.crop.split(',').map(Number) : undefined,
  });
  writePng(output, out);
  console.log(`${output}: ${out.w} x ${out.h}`);
}
