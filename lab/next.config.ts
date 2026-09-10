import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { NextConfig } from 'next'

const appDirectory = path.dirname(fileURLToPath(import.meta.url))

const nextConfig: NextConfig = {
  logging: {
    browserToTerminal: true,
  },
  transpilePackages: [
    '@pascal-app/core',
    '@pascal-app/editor',
    '@pascal-app/nodes',
    '@pascal-app/plugin-environment',
    '@pascal-app/viewer',
    'three',
  ],
  turbopack: {
    root: path.resolve(appDirectory, '../..'),
    resolveAlias: {
      '@pascal-app/core': '../../editor/packages/core',
      '@pascal-app/editor': '../../editor/packages/editor/src/index.tsx',
      '@pascal-app/nodes': '../../editor/packages/nodes',
      '@pascal-app/plugin-environment/lab/catalog': '../src/lab/catalog.ts',
      '@pascal-app/plugin-environment/lab': '../src/lab/index.ts',
      '@pascal-app/plugin-environment': '../src/index.ts',
      '@pascal-app/viewer': '../../editor/packages/viewer',
      '@react-three/drei': './node_modules/@react-three/drei',
      '@react-three/fiber': './node_modules/@react-three/fiber',
      react: './node_modules/react',
      'react-dom': './node_modules/react-dom',
      three: './node_modules/three',
      'three/webgpu': './node_modules/three/build/three.webgpu.js',
      'three/tsl': './node_modules/three/build/three.tsl.js',
      'three/addons/*': './node_modules/three/examples/jsm/*',
      'three/examples/jsm/*': './node_modules/three/examples/jsm/*',
      'three/src/*': './node_modules/three/src/*',
      zustand: './node_modules/zustand',
    },
  },
  images: {
    unoptimized: true,
    remotePatterns: [
      { protocol: 'https', hostname: '**' },
      { protocol: 'http', hostname: '**' },
    ],
  },
}

export default nextConfig
