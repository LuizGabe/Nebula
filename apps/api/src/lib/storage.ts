// src/lib/storage.ts
import { config } from "../config/index.js";
import { S3Client, CreateBucketCommand, HeadBucketCommand } from "@aws-sdk/client-s3";

export const s3Internal = new S3Client({
  endpoint: config.MINIO_INTERNAL_ENDPOINT,
  region: "us-east-1",
  credentials: {
    accessKeyId: config.MINIO_ACCESS_KEY,
    secretAccessKey: config.MINIO_SECRET_KEY,
  },
  forcePathStyle: true,
});

export const s3Public = new S3Client({
  endpoint: config.MINIO_PUBLIC_ENDPOINT,
  region: "us-east-1",
  credentials: { accessKeyId: config.MINIO_ACCESS_KEY, secretAccessKey: config.MINIO_SECRET_KEY },
  forcePathStyle: true,
  requestChecksumCalculation: "WHEN_REQUIRED",
  responseChecksumValidation: "WHEN_REQUIRED"
});

export const BUCKET = config.MINIO_BUCKET;

export async function ensureBucketExists() {
  try {
    await s3Internal.send(new HeadBucketCommand({ Bucket: BUCKET }));
  } catch {
    await s3Internal.send(new CreateBucketCommand({ Bucket: BUCKET }));
    console.log(`Bucket '${BUCKET}' criado`);
  }
}