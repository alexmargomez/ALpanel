import crypto from 'crypto';

const BLAKE2B_IV_LO = new Uint32Array([
  0xf3bcc908, 0x84caa73b, 0xfe94f82b, 0x5f1d36f1,
  0xade682d1, 0x2b3e6c1f, 0xfb41bd6b, 0x137e2179,
]);
const BLAKE2B_IV_HI = new Uint32Array([
  0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
  0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
]);

const BLAKE2B_SIGMA = new Uint8Array([
  0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15,
  14, 10, 4, 8, 9, 15, 13, 6, 1, 12, 0, 2, 11, 7, 5, 3,
  11, 8, 12, 0, 5, 2, 15, 13, 10, 14, 3, 6, 7, 1, 9, 4,
  7, 9, 3, 1, 13, 12, 11, 14, 2, 6, 5, 10, 4, 0, 15, 8,
  9, 0, 5, 7, 2, 4, 10, 15, 14, 1, 11, 12, 6, 8, 3, 13,
  2, 12, 6, 10, 0, 11, 8, 3, 4, 13, 7, 5, 15, 14, 1, 9,
  12, 5, 1, 15, 14, 13, 4, 10, 0, 7, 6, 3, 9, 2, 8, 11,
  13, 11, 7, 14, 12, 1, 3, 9, 5, 0, 15, 4, 8, 6, 2, 10,
  6, 15, 14, 9, 11, 3, 0, 8, 12, 2, 13, 7, 1, 4, 10, 5,
  10, 2, 8, 4, 7, 6, 1, 5, 15, 11, 9, 14, 3, 12, 13, 0,
  0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15,
  14, 10, 4, 8, 9, 15, 13, 6, 1, 12, 0, 2, 11, 7, 5, 3,
]);

export function blake2b(input: Uint8Array, outLen = 64): Uint8Array {
  if (outLen === 64) {
    return new Uint8Array(crypto.createHash('blake2b512').update(input).digest());
  }

  const hLo = new Uint32Array(BLAKE2B_IV_LO);
  const hHi = new Uint32Array(BLAKE2B_IV_HI);
  hLo[0] ^= 0x01010000 | outLen;

  const vLo = new Uint32Array(16);
  const vHi = new Uint32Array(16);
  const mLo = new Uint32Array(16);
  const mHi = new Uint32Array(16);
  const block = new Uint8Array(128);
  const blockU32 = new Uint32Array(block.buffer);

  const B2B_G = (a: number, b: number, c: number, d: number, xLo: number, xHi: number, yLo: number, yHi: number) => {
    let l = (vLo[a] + vLo[b]) >>> 0;
    let h = (vHi[a] + vHi[b] + (l < vLo[a] ? 1 : 0)) >>> 0;
    let l2 = (l + xLo) >>> 0;
    h = (h + xHi + (l2 < l ? 1 : 0)) >>> 0;
    vLo[a] = l2;
    vHi[a] = h;

    let xl = vLo[d] ^ l2;
    let xh = vHi[d] ^ h;
    vLo[d] = xh;
    vHi[d] = xl;

    l = (vLo[c] + xh) >>> 0;
    h = (vHi[c] + xl + (l < vLo[c] ? 1 : 0)) >>> 0;
    vLo[c] = l;
    vHi[c] = h;

    xl = vLo[b] ^ l;
    xh = vHi[b] ^ h;
    vLo[b] = (xl >>> 24) | (xh << 8);
    vHi[b] = (xh >>> 24) | (xl << 8);

    l = (vLo[a] + vLo[b]) >>> 0;
    h = (vHi[a] + vHi[b] + (l < vLo[a] ? 1 : 0)) >>> 0;
    l2 = (l + yLo) >>> 0;
    h = (h + yHi + (l2 < l ? 1 : 0)) >>> 0;
    vLo[a] = l2;
    vHi[a] = h;

    xl = vLo[d] ^ l2;
    xh = vHi[d] ^ h;
    vLo[d] = (xl >>> 16) | (xh << 16);
    vHi[d] = (xh >>> 16) | (xl << 16);

    l = (vLo[c] + vLo[d]) >>> 0;
    h = (vHi[c] + vHi[d] + (l < vLo[c] ? 1 : 0)) >>> 0;
    vLo[c] = l;
    vHi[c] = h;

    xl = vLo[b] ^ l;
    xh = vHi[b] ^ h;
    vLo[b] = (xh >>> 31) | (xl << 1);
    vHi[b] = (xl >>> 31) | (xh << 1);
  };

  const compress = (tLo: number, isLast: boolean) => {
    for (let i = 0; i < 8; i++) {
      vLo[i] = hLo[i];
      vHi[i] = hHi[i];
      vLo[i + 8] = BLAKE2B_IV_LO[i];
      vHi[i + 8] = BLAKE2B_IV_HI[i];
    }
    vLo[12] ^= tLo;
    if (isLast) {
      vLo[14] ^= 0xffffffff;
      vHi[14] ^= 0xffffffff;
    }
    for (let i = 0; i < 16; i++) {
      mLo[i] = blockU32[i * 2];
      mHi[i] = blockU32[i * 2 + 1];
    }

    for (let r = 0; r < 12; r++) {
      const base = r * 16;
      let s0 = BLAKE2B_SIGMA[base], s1 = BLAKE2B_SIGMA[base + 1];
      B2B_G(0, 4, 8, 12, mLo[s0], mHi[s0], mLo[s1], mHi[s1]);
      s0 = BLAKE2B_SIGMA[base + 2]; s1 = BLAKE2B_SIGMA[base + 3];
      B2B_G(1, 5, 9, 13, mLo[s0], mHi[s0], mLo[s1], mHi[s1]);
      s0 = BLAKE2B_SIGMA[base + 4]; s1 = BLAKE2B_SIGMA[base + 5];
      B2B_G(2, 6, 10, 14, mLo[s0], mHi[s0], mLo[s1], mHi[s1]);
      s0 = BLAKE2B_SIGMA[base + 6]; s1 = BLAKE2B_SIGMA[base + 7];
      B2B_G(3, 7, 11, 15, mLo[s0], mHi[s0], mLo[s1], mHi[s1]);
      s0 = BLAKE2B_SIGMA[base + 8]; s1 = BLAKE2B_SIGMA[base + 9];
      B2B_G(0, 5, 10, 15, mLo[s0], mHi[s0], mLo[s1], mHi[s1]);
      s0 = BLAKE2B_SIGMA[base + 10]; s1 = BLAKE2B_SIGMA[base + 11];
      B2B_G(1, 6, 11, 12, mLo[s0], mHi[s0], mLo[s1], mHi[s1]);
      s0 = BLAKE2B_SIGMA[base + 12]; s1 = BLAKE2B_SIGMA[base + 13];
      B2B_G(2, 7, 8, 13, mLo[s0], mHi[s0], mLo[s1], mHi[s1]);
      s0 = BLAKE2B_SIGMA[base + 14]; s1 = BLAKE2B_SIGMA[base + 15];
      B2B_G(3, 4, 9, 14, mLo[s0], mHi[s0], mLo[s1], mHi[s1]);
    }

    for (let i = 0; i < 8; i++) {
      hLo[i] ^= vLo[i] ^ vLo[i + 8];
      hHi[i] ^= vHi[i] ^ vHi[i + 8];
    }
  };

  let offset = 0;
  let total = 0;
  while (input.length - offset > 128) {
    block.set(input.subarray(offset, offset + 128));
    total += 128;
    compress(total, false);
    offset += 128;
  }

  block.fill(0);
  const rem = input.length - offset;
  if (rem > 0) {
    block.set(input.subarray(offset));
  }
  total += rem;
  compress(total, true);

  const outU32 = new Uint32Array(16);
  for (let i = 0; i < 8; i++) {
    outU32[i * 2] = hLo[i];
    outU32[i * 2 + 1] = hHi[i];
  }
  return new Uint8Array(outU32.buffer, 0, outLen);
}

function blake2bLong(input: Uint8Array, outLen: number): Uint8Array {
  const lenBytes = new Uint8Array(4);
  new DataView(lenBytes.buffer).setUint32(0, outLen, true);
  const prefixed = new Uint8Array(4 + input.length);
  prefixed.set(lenBytes, 0);
  prefixed.set(input, 4);

  if (outLen <= 64) {
    return blake2b(prefixed, outLen);
  }

  const out = new Uint8Array(outLen);
  let v = blake2b(prefixed, 64);
  out.set(v.subarray(0, 32), 0);
  let pos = 32;

  while (outLen - pos > 64) {
    v = blake2b(v, 64);
    out.set(v.subarray(0, 32), pos);
    pos += 32;
  }

  const last = blake2b(v, outLen - pos);
  out.set(last, pos);
  return out;
}

let mulHi = 0;
function mul32(x: number, y: number): number {
  const x0 = x & 0xffff;
  const x1 = x >>> 16;
  const y0 = y & 0xffff;
  const y1 = y >>> 16;
  const p00 = Math.imul(x0, y0) >>> 0;
  const p01 = Math.imul(x0, y1) >>> 0;
  const p10 = Math.imul(x1, y0) >>> 0;
  const p11 = Math.imul(x1, y1) >>> 0;
  const mid = ((p00 >>> 16) + (p01 & 0xffff) + (p10 & 0xffff)) >>> 0;
  mulHi = (p11 + (p01 >>> 16) + (p10 >>> 16) + (mid >>> 16)) >>> 0;
  return ((mid << 16) | (p00 & 0xffff)) >>> 0;
}

function gRoundU32(z: Uint32Array, a: number, b: number, c: number, d: number): void {
  const a2 = a * 2, b2 = b * 2, c2 = c * 2, d2 = d * 2;
  let alo = z[a2], ahi = z[a2 + 1];
  let blo = z[b2], bhi = z[b2 + 1];
  let clo = z[c2], chi = z[c2 + 1];
  let dlo = z[d2], dhi = z[d2 + 1];

  // fBlaMka(a, b)
  let mlo = mul32(alo, blo);
  let mhi = mulHi;
  let m2hi = ((mhi << 1) | (mlo >>> 31)) >>> 0;
  let m2lo = (mlo << 1) >>> 0;
  let s = (alo + blo) >>> 0;
  let cBit = s < alo ? 1 : 0;
  ahi = (ahi + bhi + cBit) >>> 0;
  alo = (s + m2lo) >>> 0;
  ahi = (ahi + m2hi + (alo < s ? 1 : 0)) >>> 0;

  // d = rotr64(d ^ a, 32)
  let xlo = dlo ^ alo, xhi = dhi ^ ahi;
  dlo = xhi; dhi = xlo;

  // fBlaMka(c, d)
  mlo = mul32(clo, dlo);
  mhi = mulHi;
  m2hi = ((mhi << 1) | (mlo >>> 31)) >>> 0;
  m2lo = (mlo << 1) >>> 0;
  s = (clo + dlo) >>> 0;
  cBit = s < clo ? 1 : 0;
  chi = (chi + dhi + cBit) >>> 0;
  clo = (s + m2lo) >>> 0;
  chi = (chi + m2hi + (clo < s ? 1 : 0)) >>> 0;

  // b = rotr64(b ^ c, 24)
  xlo = blo ^ clo; xhi = bhi ^ chi;
  blo = ((xlo >>> 24) | (xhi << 8)) >>> 0;
  bhi = ((xhi >>> 24) | (xlo << 8)) >>> 0;

  // fBlaMka(a, b)
  mlo = mul32(alo, blo);
  mhi = mulHi;
  m2hi = ((mhi << 1) | (mlo >>> 31)) >>> 0;
  m2lo = (mlo << 1) >>> 0;
  s = (alo + blo) >>> 0;
  cBit = s < alo ? 1 : 0;
  ahi = (ahi + bhi + cBit) >>> 0;
  alo = (s + m2lo) >>> 0;
  ahi = (ahi + m2hi + (alo < s ? 1 : 0)) >>> 0;

  // d = rotr64(d ^ a, 16)
  xlo = dlo ^ alo; xhi = dhi ^ ahi;
  dlo = ((xlo >>> 16) | (xhi << 16)) >>> 0;
  dhi = ((xhi >>> 16) | (xlo << 16)) >>> 0;

  // fBlaMka(c, d)
  mlo = mul32(clo, dlo);
  mhi = mulHi;
  m2hi = ((mhi << 1) | (mlo >>> 31)) >>> 0;
  m2lo = (mlo << 1) >>> 0;
  s = (clo + dlo) >>> 0;
  cBit = s < clo ? 1 : 0;
  chi = (chi + dhi + cBit) >>> 0;
  clo = (s + m2lo) >>> 0;
  chi = (chi + m2hi + (clo < s ? 1 : 0)) >>> 0;

  // b = rotr64(b ^ c, 63)
  xlo = blo ^ clo; xhi = bhi ^ chi;
  blo = ((xhi >>> 31) | (xlo << 1)) >>> 0;
  bhi = ((xlo >>> 31) | (xhi << 1)) >>> 0;

  z[a2] = alo; z[a2 + 1] = ahi;
  z[b2] = blo; z[b2 + 1] = bhi;
  z[c2] = clo; z[c2 + 1] = chi;
  z[d2] = dlo; z[d2 + 1] = dhi;
}

function permutePU32(
  z: Uint32Array,
  i0: number, i1: number, i2: number, i3: number,
  i4: number, i5: number, i6: number, i7: number,
  i8: number, i9: number, i10: number, i11: number,
  i12: number, i13: number, i14: number, i15: number
): void {
  gRoundU32(z, i0, i4, i8, i12);
  gRoundU32(z, i1, i5, i9, i13);
  gRoundU32(z, i2, i6, i10, i14);
  gRoundU32(z, i3, i7, i11, i15);
  gRoundU32(z, i0, i5, i10, i15);
  gRoundU32(z, i1, i6, i11, i12);
  gRoundU32(z, i2, i7, i8, i13);
  gRoundU32(z, i3, i4, i9, i14);
}

// Each 1024-byte block = 256 uint32s (128 x 64-bit words)
function compressBlockU32(
  mem: Uint32Array,
  dstU32: number,
  refU32: number,
  prevU32: number,
  xorWithDst: boolean,
  tmpR: Uint32Array,
  tmpZ: Uint32Array
): void {
  for (let i = 0; i < 256; i++) {
    const val = mem[refU32 + i] ^ mem[prevU32 + i];
    tmpR[i] = val;
    tmpZ[i] = val;
  }

  for (let row = 0; row < 8; row++) {
    const b = row * 16;
    permutePU32(
      tmpZ,
      b, b + 1, b + 2, b + 3, b + 4, b + 5, b + 6, b + 7,
      b + 8, b + 9, b + 10, b + 11, b + 12, b + 13, b + 14, b + 15
    );
  }

  for (let col = 0; col < 8; col++) {
    const c = col * 2;
    permutePU32(
      tmpZ,
      c, c + 1, c + 16, c + 17, c + 32, c + 33, c + 48, c + 49,
      c + 64, c + 65, c + 80, c + 81, c + 96, c + 97, c + 112, c + 113
    );
  }

  if (xorWithDst) {
    for (let i = 0; i < 256; i++) {
      mem[dstU32 + i] ^= tmpR[i] ^ tmpZ[i];
    }
  } else {
    for (let i = 0; i < 256; i++) {
      mem[dstU32 + i] = tmpR[i] ^ tmpZ[i];
    }
  }
}

export function argon2idRaw(
  password: Buffer | Uint8Array,
  salt: Buffer | Uint8Array,
  timeCost = 1,
  memoryKiB = 32768,
  parallelism = 2,
  tagLen = 32
): Buffer {
  const lanes = parallelism;
  const syncPoints = 4;
  const segmentLength = Math.floor(memoryKiB / (lanes * syncPoints));
  const laneLength = segmentLength * syncPoints;
  const memoryBlocks = laneLength * lanes;

  const h0Len = 10 * 4 + password.length + salt.length;
  const h0Input = new Uint8Array(h0Len);
  const h0View = new DataView(h0Input.buffer);
  let p = 0;
  const writeU32 = (val: number) => {
    h0View.setUint32(p, val, true);
    p += 4;
  };
  writeU32(lanes);
  writeU32(tagLen);
  writeU32(memoryKiB);
  writeU32(timeCost);
  writeU32(0x13);
  writeU32(2);
  writeU32(password.length);
  h0Input.set(password, p);
  p += password.length;
  writeU32(salt.length);
  h0Input.set(salt, p);
  p += salt.length;
  writeU32(0);
  writeU32(0);

  const h0 = blake2b(h0Input, 64);

  const mem = new Uint32Array(memoryBlocks * 256);
  const memBytes = new Uint8Array(mem.buffer);

  const seedInput = new Uint8Array(72);
  seedInput.set(h0, 0);
  const seedView = new DataView(seedInput.buffer);

  for (let lane = 0; lane < lanes; lane++) {
    for (let idx = 0; idx < 2; idx++) {
      seedView.setUint32(64, idx, true);
      seedView.setUint32(68, lane, true);
      const blockBytes = blake2bLong(seedInput, 1024);
      memBytes.set(blockBytes, (lane * laneLength + idx) * 1024);
    }
  }

  const tmpR = new Uint32Array(256);
  const tmpZ = new Uint32Array(256);
  const addrMem = new Uint32Array(3 * 256); // zero (0..255), input (256..511), out (512..767)

  for (let pass = 0; pass < timeCost; pass++) {
    for (let slice = 0; slice < syncPoints; slice++) {
      const dataIndependent = pass === 0 && slice < 2;

      for (let lane = 0; lane < lanes; lane++) {
        let addrCounter = 0;
        if (dataIndependent) {
          addrMem.fill(0, 256, 512);
          addrMem[256 + 0] = pass;
          addrMem[256 + 2] = lane;
          addrMem[256 + 4] = slice;
          addrMem[256 + 6] = memoryBlocks;
          addrMem[256 + 8] = timeCost;
          addrMem[256 + 10] = 2;
        }

        const startIdx = pass === 0 && slice === 0 ? 2 : 0;
        for (let idx = startIdx; idx < segmentLength; idx++) {
          const currCol = slice * segmentLength + idx;
          const prevCol = currCol === 0 ? laneLength - 1 : currCol - 1;
          const dstBlock = lane * laneLength + currCol;
          const prevBlock = lane * laneLength + prevCol;

          let j1: number;
          let j2: number;
          if (dataIndependent) {
            if (idx % 128 === 0 || idx === startIdx) {
              if (idx === startIdx && idx > 0) {
                addrCounter = Math.floor(idx / 128) + 1;
              } else {
                addrCounter++;
              }
              addrMem[256 + 12] = addrCounter;
              compressBlockU32(addrMem, 512, 0, 256, false, tmpR, tmpZ);
              compressBlockU32(addrMem, 512, 0, 512, false, tmpR, tmpZ);
            }
            const wordIdx = (idx % 128) * 2;
            j1 = addrMem[512 + wordIdx];
            j2 = addrMem[512 + wordIdx + 1];
          } else {
            const pBase = prevBlock * 256;
            j1 = mem[pBase];
            j2 = mem[pBase + 1];
          }

          const refLane = pass === 0 && slice === 0 ? lane : j2 % lanes;

          let refAreaSize: number;
          if (pass === 0) {
            if (slice === 0 || lane === refLane) {
              refAreaSize = currCol - 1;
            } else {
              refAreaSize = slice * segmentLength - (idx === 0 ? 1 : 0);
            }
          } else if (lane === refLane) {
            refAreaSize = laneLength - segmentLength + idx - 1;
          } else {
            refAreaSize = laneLength - segmentLength - (idx === 0 ? 1 : 0);
          }

          mul32(j1, j1);
          const xHi = mulHi;
          mul32(refAreaSize >>> 0, xHi);
          const yHi = mulHi;
          const relPos = refAreaSize - 1 - yHi;
          const startPos =
            pass !== 0 && slice !== syncPoints - 1
              ? (slice + 1) * segmentLength
              : 0;
          const refCol = (startPos + relPos) % laneLength;
          const refBlock = refLane * laneLength + refCol;

          compressBlockU32(
            mem,
            dstBlock * 256,
            refBlock * 256,
            prevBlock * 256,
            pass > 0,
            tmpR,
            tmpZ
          );
        }
      }
    }
  }

  const finalBlock = new Uint32Array(256);
  for (let lane = 0; lane < lanes; lane++) {
    const lastOffset = (lane * laneLength + (laneLength - 1)) * 256;
    for (let i = 0; i < 256; i++) {
      finalBlock[i] ^= mem[lastOffset + i];
    }
  }

  const finalBytes = new Uint8Array(finalBlock.buffer);
  return Buffer.from(blake2bLong(finalBytes, tagLen));
}

export function hashProvekoArgon2id(password: string, explicitSalt?: Buffer): string {
  const salt = explicitSalt || crypto.randomBytes(16);
  const derived = argon2idRaw(Buffer.from(password, 'utf-8'), salt, 1, 32 * 1024, 2, 32);
  return `argon2id$${salt.toString('hex')}$${derived.toString('hex')}`;
}

export function verifyProvekoArgon2id(password: string, encodedHash: string): boolean {
  const parts = (encodedHash || '').split('$');
  if (parts.length !== 3 || parts[0] !== 'argon2id') return false;
  try {
    const salt = Buffer.from(parts[1], 'hex');
    const expected = Buffer.from(parts[2], 'hex');
    if (salt.length === 0 || expected.length !== 32) return false;
    const computed = argon2idRaw(Buffer.from(password, 'utf-8'), salt, 1, 32 * 1024, 2, 32);
    return crypto.timingSafeEqual(computed, expected);
  } catch {
    return false;
  }
}
