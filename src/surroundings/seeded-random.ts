export function hashString(value: string): number {
  let hash = 0x81_1c_9d_c5
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 0x01_00_01_93)
  }
  return hash >>> 0
}

export function seededUnit(seed: string, domain: string): number {
  return hashString(`${seed}:${domain}`) / 0x1_00_00_00_00
}

export function seededRange(
  seed: string,
  domain: string,
  minimum: number,
  maximum: number,
): number {
  return minimum + (maximum - minimum) * seededUnit(seed, domain)
}
