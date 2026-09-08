/** @type {import('next').NextConfig} */
const nextConfig = {
  // Type errors are no longer ignored: `ignoreBuildErrors: true` is what let an
  // undefined `hairMaterial` reference ship inside Raven3D's cleanup path.
  typescript: {
    ignoreBuildErrors: false,
  },

  images: {
    unoptimized: true,
  },

  // Tunnels/preview hosts change per machine; env-driven instead of a baked-in LAN IP.
  // e2b/Gitpod-style wildcards are supported by allowedDevOrigins.
  allowedDevOrigins: (process.env.NEXT_ALLOWED_DEV_ORIGINS || '10.130.75.117,*.e2b.app,*.gitpod.io')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean),
}

export default nextConfig
