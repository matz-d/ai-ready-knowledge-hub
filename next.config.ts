import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  output: 'standalone',
  serverExternalPackages: [
    '@google-cloud/tasks',
    '@napi-rs/canvas',
    'pdf-parse',
    'pdfjs-dist',
  ],
};

export default nextConfig;
