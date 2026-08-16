/** @type {import('next').NextConfig} */
const nextConfig = {
  // `@mw/domain` is TypeScript source outside this app, shared with the mobile
  // app. Next has to be told to compile it rather than expect built JavaScript.
  transpilePackages: ['@mw/domain'],

  // This console can write global warranty and provider data. It is internal,
  // and nothing about it should be reachable, embeddable or indexable.
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Robots-Tag', value: 'noindex, nofollow' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'same-origin' },
        ],
      },
    ];
  },
};

export default nextConfig;
