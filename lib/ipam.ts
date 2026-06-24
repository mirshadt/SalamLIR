import type { Assignment, Pool } from "@/lib/api";

export type Range = {
  cidr: string;
  start: number;
  end: number;
  prefix: number;
  size: number;
  firstUsable: string;
  lastUsable: string;
};

export type ContinuousFreeRange = {
  start: number;
  end: number;
  size: number;
  label: string;
  firstUsable: string;
  lastUsable: string;
};

export function parseCidr(input: string): Range {
  const [ipPart, prefixPart] = input.trim().split("/");
  const prefix = Number.parseInt(prefixPart, 10);
  if (!ipPart || !Number.isInteger(prefix) || prefix < 0 || prefix > 32) {
    throw new Error("Invalid CIDR");
  }
  const ip = ipToNumber(ipPart);
  const size = 2 ** (32 - prefix);
  const start = Math.floor(ip / size) * size;
  const end = start + size - 1;
  return {
    cidr: `${numberToIp(start)}/${prefix}`,
    start,
    end,
    prefix,
    size,
    firstUsable: numberToIp(prefix >= 31 ? start : start + 1),
    lastUsable: numberToIp(prefix >= 31 ? end : end - 1)
  };
}

export function toRange(item: Pool | Assignment | string): Range {
  return parseCidr(typeof item === "string" ? item : item.cidr);
}

export function contains(parent: Range, child: Range) {
  return parent.start <= child.start && parent.end >= child.end;
}

export function calculateFreeRanges(pool: Pool, assignments: Assignment[]) {
  const parent = toRange(pool);
  const occupied = assignments
    .map((assignment) => toRange(assignment))
    .filter((range) => contains(parent, range))
    .sort((left, right) => left.start - right.start);

  const intervals: Array<{ start: number; end: number }> = [];
  let cursor = parent.start;
  for (const range of occupied) {
    if (range.start > cursor) {
      intervals.push({ start: cursor, end: range.start - 1 });
    }
    cursor = Math.max(cursor, range.end + 1);
  }
  if (cursor <= parent.end) {
    intervals.push({ start: cursor, end: parent.end });
  }
  return intervals.flatMap((interval) => rangeToCidrs(interval.start, interval.end)).slice(0, 24);
}

export function calculateContinuousFreeRanges(pool: Pool, assignments: Assignment[]): ContinuousFreeRange[] {
  const parent = toRange(pool);
  const occupied = assignments
    .map((assignment) => toRange(assignment))
    .filter((range) => contains(parent, range))
    .sort((left, right) => left.start - right.start);

  const intervals: ContinuousFreeRange[] = [];
  let cursor = parent.start;
  for (const range of occupied) {
    if (range.start > cursor) {
      intervals.push(toContinuousRange(cursor, range.start - 1));
    }
    cursor = Math.max(cursor, range.end + 1);
  }
  if (cursor <= parent.end) {
    intervals.push(toContinuousRange(cursor, parent.end));
  }
  return intervals;
}

function toContinuousRange(start: number, end: number): ContinuousFreeRange {
  return {
    start,
    end,
    size: end - start + 1,
    label: `${numberToIp(start)} - ${numberToIp(end)}`,
    firstUsable: numberToIp(start),
    lastUsable: numberToIp(end)
  };
}

export function rangeToCidrs(start: number, end: number): Range[] {
  const ranges: Range[] = [];
  let current = start;
  while (current <= end && ranges.length < 256) {
    let blockSize = largestAlignedBlock(current);
    const remaining = end - current + 1;
    while (blockSize > remaining) {
      blockSize /= 2;
    }
    const prefix = 32 - Math.floor(Math.log2(blockSize));
    ranges.push(parseCidr(`${numberToIp(current)}/${prefix}`));
    current += blockSize;
  }
  return ranges;
}

function largestAlignedBlock(start: number) {
  let size = 1;
  while (size < 2 ** 32 && start % (size * 2) === 0) {
    size *= 2;
  }
  return size;
}

export function ipToNumber(value: string) {
  const octets = value.split(".").map((part) => Number.parseInt(part, 10));
  if (octets.length !== 4 || octets.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
    throw new Error("Invalid IPv4 address");
  }
  return (((octets[0] * 256 + octets[1]) * 256 + octets[2]) * 256 + octets[3]) >>> 0;
}

export function numberToIp(value: number) {
  const safe = value >>> 0;
  return [safe >>> 24, (safe >>> 16) & 255, (safe >>> 8) & 255, safe & 255].join(".");
}
