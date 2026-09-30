/** Growable little-endian binary writer. */
export class ByteWriter {
  private buf: Uint8Array;
  private view: DataView;
  length = 0;

  constructor(initial = 256) {
    this.buf = new Uint8Array(initial);
    this.view = new DataView(this.buf.buffer);
  }

  private ensure(n: number): void {
    if (this.length + n <= this.buf.length) return;
    let size = this.buf.length * 2;
    while (size < this.length + n) size *= 2;
    const next = new Uint8Array(size);
    next.set(this.buf.subarray(0, this.length));
    this.buf = next;
    this.view = new DataView(next.buffer);
  }

  u8(v: number): this {
    this.ensure(1);
    this.view.setUint8(this.length, v & 0xff);
    this.length += 1;
    return this;
  }

  i8(v: number): this {
    this.ensure(1);
    this.view.setInt8(this.length, Math.max(-128, Math.min(127, Math.round(v))));
    this.length += 1;
    return this;
  }

  u16(v: number): this {
    this.ensure(2);
    this.view.setUint16(this.length, Math.max(0, Math.min(65535, Math.round(v))), true);
    this.length += 2;
    return this;
  }

  i16(v: number): this {
    this.ensure(2);
    this.view.setInt16(this.length, Math.max(-32768, Math.min(32767, Math.round(v))), true);
    this.length += 2;
    return this;
  }

  u32(v: number): this {
    this.ensure(4);
    this.view.setUint32(this.length, v >>> 0, true);
    this.length += 4;
    return this;
  }

  f32(v: number): this {
    this.ensure(4);
    this.view.setFloat32(this.length, v, true);
    this.length += 4;
    return this;
  }

  f64(v: number): this {
    this.ensure(8);
    this.view.setFloat64(this.length, v, true);
    this.length += 8;
    return this;
  }

  bytes(b: Uint8Array): this {
    this.ensure(b.length);
    this.buf.set(b, this.length);
    this.length += b.length;
    return this;
  }

  finish(): Uint8Array {
    return this.buf.slice(0, this.length);
  }
}

export class ByteReader {
  private readonly view: DataView;
  offset = 0;

  constructor(readonly data: Uint8Array) {
    this.view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  }

  get remaining(): number {
    return this.data.length - this.offset;
  }

  private need(n: number): void {
    if (this.offset + n > this.data.length) throw new RangeError('read past end of message');
  }

  u8(): number {
    this.need(1);
    return this.view.getUint8(this.offset++);
  }

  i8(): number {
    this.need(1);
    return this.view.getInt8(this.offset++);
  }

  u16(): number {
    this.need(2);
    const v = this.view.getUint16(this.offset, true);
    this.offset += 2;
    return v;
  }

  i16(): number {
    this.need(2);
    const v = this.view.getInt16(this.offset, true);
    this.offset += 2;
    return v;
  }

  u32(): number {
    this.need(4);
    const v = this.view.getUint32(this.offset, true);
    this.offset += 4;
    return v;
  }

  f32(): number {
    this.need(4);
    const v = this.view.getFloat32(this.offset, true);
    this.offset += 4;
    return v;
  }

  f64(): number {
    this.need(8);
    const v = this.view.getFloat64(this.offset, true);
    this.offset += 8;
    return v;
  }

  bytes(n: number): Uint8Array {
    this.need(n);
    const b = this.data.subarray(this.offset, this.offset + n);
    this.offset += n;
    return b;
  }
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export function encodeText(s: string): Uint8Array {
  return encoder.encode(s);
}

export function decodeText(b: Uint8Array): string {
  return decoder.decode(b);
}
