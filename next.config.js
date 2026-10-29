/** @type {import("next").NextConfig} */
const nextConfig = {
  async headers() {
    // おさかな図鑑のモデルと実行用ファイルは大きい（合計約30MB）ので、ブラウザに長くキャッシュさせる。
    // モデルを差し替えるときは、ファイル名のバージョン（fish-s75-v1 など）を変えること。
    const immutable = [{ key: 'Cache-Control', value: 'public, max-age=31536000, immutable' }]
    return [
      { source: '/models/fish/:path*', headers: immutable },
      { source: '/ort/:path*', headers: immutable },
    ]
  },
}
module.exports = nextConfig
