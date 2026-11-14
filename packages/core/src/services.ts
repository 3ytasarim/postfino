import { getConfig, type AppConfig } from "@sichttakt/config";
import { createDb, type Db } from "@sichttakt/db";
import path from "node:path";
import { parseKeyring, type Keyring } from "./crypto";
import { AdapterRegistry } from "./channels";
import { LocalStorageDriver, type StorageDriver } from "./storage";
import { S3StorageDriver } from "./storage-s3";
import { DevOutboxMailer, SmtpMailer, type Mailer } from "./mailer";
import { createAiProvider, type AiProvider } from "./ai";

export type Services = {
  config: AppConfig;
  db: Db;
  ring: Keyring;
  registry: AdapterRegistry;
  storage: StorageDriver;
  mailer: Mailer;
  ai: AiProvider;
  close: () => Promise<void>;
};

export function createStorage(config: AppConfig, root: string, signingSecret: string): StorageDriver {
  if (config.STORAGE_DRIVER === "s3") {
    const { S3_ENDPOINT, S3_BUCKET, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY } = config;
    if (!S3_ENDPOINT || !S3_BUCKET || !S3_ACCESS_KEY_ID || !S3_SECRET_ACCESS_KEY) throw new Error("STORAGE_DRIVER=s3 requires S3_ENDPOINT, S3_BUCKET, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY");
    return new S3StorageDriver({ endpoint: S3_ENDPOINT, region: config.S3_REGION, bucket: S3_BUCKET, accessKeyId: S3_ACCESS_KEY_ID, secretAccessKey: S3_SECRET_ACCESS_KEY });
  }
  const dir = path.isAbsolute(config.MEDIA_STORAGE_DIR) ? config.MEDIA_STORAGE_DIR : path.join(root, config.MEDIA_STORAGE_DIR);
  return new LocalStorageDriver(dir, signingSecret, config.MEDIA_PUBLIC_BASE_URL);
}

/** Composition root shared by web, api and worker. `root` anchors relative storage paths to the repo. */
export function createServices(opts: { root: string; config?: AppConfig; db?: Db; maxConnections?: number }): Services {
  const config = opts.config ?? getConfig();
  const conn = opts.db ? { db: opts.db, close: async () => {} } : createDb(config.DATABASE_URL, { max: opts.maxConnections });
  const ring = parseKeyring(config.ENCRYPTION_KEYS, config.NODE_ENV);
  if (!config.SESSION_SECRET && config.NODE_ENV === "production") throw new Error("SESSION_SECRET required in production");
  const signing = config.SESSION_SECRET ?? "dev-only-signing-secret";
  if (config.NODE_ENV === "production" && !config.SMTP_URL) console.warn("[config] SMTP_URL not set — emails are written to the outbox and NOT delivered");
  const mailer: Mailer = config.SMTP_URL ? new SmtpMailer(config.SMTP_URL, config.MAIL_FROM) : new DevOutboxMailer(path.join(opts.root, ".data", "mail"), config.MAIL_FROM);
  return { config, db: conn.db, ring, registry: new AdapterRegistry(config, {}, { db: conn.db, ring }), storage: createStorage(config, opts.root, signing), mailer, ai: createAiProvider(config.ANTHROPIC_API_KEY, config.AI_MODEL), close: conn.close };
}
