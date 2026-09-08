import { integer, sqliteTable, text, index, primaryKey } from "drizzle-orm/sqlite-core";
export const workspaces = sqliteTable("workspaces", {
  owner: text("owner").primaryKey(), encrypted: text("encrypted").notNull(),
  revision: integer("revision").notNull().default(1), updated: text("updated").notNull(),
});
export const jobs = sqliteTable("jobs", {
  id: text("id").primaryKey(), owner: text("owner").notNull(), encrypted: text("encrypted").notNull(),
  state: text("state").notNull(), created: text("created").notNull(), expires: text("expires").notNull(),
  resultDigest: text("result_digest"), result: text("result"),
}, table => [index("idx_jobs_owner_created").on(table.owner, table.created)]);
export const jobTargets = sqliteTable("job_targets", {
  owner: text("owner").notNull(), device: text("device").notNull(), job: text("job").notNull(), expires: text("expires").notNull(),
}, table => [primaryKey({ columns: [table.owner, table.device] }), index("idx_job_targets_job").on(table.job)]);
export const audit = sqliteTable("audit", {
  id: text("id").primaryKey(), owner: text("owner").notNull(), event: text("event").notNull(), summary: text("summary").notNull(), created: text("created").notNull(),
}, table => [index("idx_audit_owner_created").on(table.owner, table.created)]);
