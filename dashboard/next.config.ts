import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Lets a local production test build use its own folder (NEXT_DIST_DIR=.next-prod) without touching `npm run dev`'s .next
  distDir: process.env.NEXT_DIST_DIR || ".next",
  // The dashboard folder is the app root (avoids picking up stray lockfiles higher up the disk)
  outputFileTracingRoot: path.join(__dirname),
  // "Ask the data" reads the passage index at request time; make sure it ships with the serverless function
  outputFileTracingIncludes: {
    "/api/ask": ["./data/search_chunks.json"],
  },
};

export default nextConfig;
