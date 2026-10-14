import { Matrix4, Quaternion, Vector3 } from 'three'

const UP = new Vector3(0, 1, 0)
const surfaceNormal = new Vector3()
const tilt = new Quaternion()
const yawRotation = new Quaternion()

/** Align local +Y to the ground, then turn around that normal; flat transforms stay unchanged. */
export function setPlantingRotation(
  matrix: Matrix4,
  normal: readonly [number, number, number],
  yaw: number,
): Matrix4 {
  if (normal[0] === 0 && normal[2] === 0) return matrix.makeRotationY(yaw)
  tilt.setFromUnitVectors(UP, surfaceNormal.set(...normal))
  yawRotation.setFromAxisAngle(UP, yaw)
  return matrix.makeRotationFromQuaternion(tilt.multiply(yawRotation))
}

/** Keep unchanged Float32 instance buffers untouched during repeated terrain notifications. */
export function writePlantingMatrix(
  values: Float32Array,
  offset: number,
  matrix: Matrix4,
): boolean {
  let changed = false
  for (let component = 0; component < 16; component += 1) {
    const value = Math.fround(matrix.elements[component] ?? 0)
    if (values[offset + component] !== value) {
      values[offset + component] = value
      changed = true
    }
  }
  return changed
}
