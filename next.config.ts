import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactCompiler: true,
  experimental: {
    // Resume PDFs are base64-encoded and POSTed to the parseResumePdf server
    // action; base64 inflates bytes ~33%, so 8mb covers a ~6 MB PDF.
    serverActions: {
      bodySizeLimit: "8mb",
    },
  },
};

export default nextConfig;
