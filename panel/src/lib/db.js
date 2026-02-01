import mongoose from "mongoose";
import { env } from "./env.js";

let cached = global._mongoosePanel;

if (!cached) {
  cached = global._mongoosePanel = { conn: null, promise: null };
}

export async function connectDb() {
  if (cached.conn) return cached.conn;

  if (!cached.promise) {
    cached.promise = mongoose
      .connect(env.mongoUri, { autoIndex: true })
      .then((mongooseInstance) => mongooseInstance);
  }

  cached.conn = await cached.promise;
  return cached.conn;
}