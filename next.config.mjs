/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // dockerode (and its deps ssh2 / cpu-features) use dynamic require() and ship
  // optional native bindings, which Next's server bundler can't pack — left
  // un-externalized this throws at import time and the exec route 500s. Keeping
  // these external makes Next `require()` them from node_modules at runtime,
  // exactly as a plain Node server would.
  experimental: {
    serverComponentsExternalPackages: [
      "dockerode",
      "docker-modem",
      "ssh2",
      "cpu-features",
      "tar-stream",
    ],
  },
};

export default nextConfig;
