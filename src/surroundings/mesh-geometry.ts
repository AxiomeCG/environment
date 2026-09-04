export type MeshGeometryBuffers = Readonly<{
  indices: Uint32Array
  normals: Float32Array
  positions: Float32Array
  colors?: Float32Array
}>

export function buildMeshGeometryBuffers(
  positions: readonly number[],
  indices: readonly number[],
  colors?: readonly number[],
): MeshGeometryBuffers {
  const positionBuffer = new Float32Array(positions)
  const indexBuffer = new Uint32Array(indices)
  const normals = new Float32Array(positionBuffer.length)

  for (let offset = 0; offset < indexBuffer.length; offset += 3) {
    const first = indexBuffer[offset]! * 3
    const second = indexBuffer[offset + 1]! * 3
    const third = indexBuffer[offset + 2]! * 3
    const firstSecondX = positionBuffer[second]! - positionBuffer[first]!
    const firstSecondY = positionBuffer[second + 1]! - positionBuffer[first + 1]!
    const firstSecondZ = positionBuffer[second + 2]! - positionBuffer[first + 2]!
    const firstThirdX = positionBuffer[third]! - positionBuffer[first]!
    const firstThirdY = positionBuffer[third + 1]! - positionBuffer[first + 1]!
    const firstThirdZ = positionBuffer[third + 2]! - positionBuffer[first + 2]!
    const normalX = firstSecondY * firstThirdZ - firstSecondZ * firstThirdY
    const normalY = firstSecondZ * firstThirdX - firstSecondX * firstThirdZ
    const normalZ = firstSecondX * firstThirdY - firstSecondY * firstThirdX

    for (const index of [first, second, third]) {
      normals[index] = normals[index]! + normalX
      normals[index + 1] = normals[index + 1]! + normalY
      normals[index + 2] = normals[index + 2]! + normalZ
    }
  }

  for (let index = 0; index < normals.length; index += 3) {
    const length = Math.hypot(
      normals[index]!,
      normals[index + 1]!,
      normals[index + 2]!,
    )
    if (length <= 1e-9) {
      normals[index + 1] = 1
      continue
    }
    normals[index] = normals[index]! / length
    normals[index + 1] = normals[index + 1]! / length
    normals[index + 2] = normals[index + 2]! / length
  }

  return {
    indices: indexBuffer,
    normals,
    positions: positionBuffer,
    colors: colors ? new Float32Array(colors) : undefined,
  }
}
