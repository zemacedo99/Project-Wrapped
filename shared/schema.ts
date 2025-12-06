import { sql } from "drizzle-orm";
import { pgTable, text, varchar, integer, jsonb, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const users = pgTable("users", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  username: text("username").notNull().unique(),
  password: text("password").notNull(),
});

export const insertUserSchema = createInsertSchema(users).pick({
  username: true,
  password: true,
});

export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof users.$inferSelect;

export const contributorSchema = z.object({
  name: z.string(),
  commits: z.number(),
  pullRequestsOpened: z.number(),
  pullRequestsReviewed: z.number(),
  commentsWritten: z.number(),
  bugsFixed: z.number(),
  storyPointsDone: z.number(),
});

export const moduleSchema = z.object({
  name: z.string(),
  commits: z.number(),
  pullRequests: z.number(),
  storyPointsDone: z.number(),
  status: z.string(),
});

export const top5EntrySchema = z.object({
  name: z.string(),
  commits: z.number().optional(),
  pullRequestsOpened: z.number().optional(),
  pullRequestsReviewed: z.number().optional(),
  commentsWritten: z.number().optional(),
});

export const busiestDaySchema = z.object({
  date: z.string(),
  commits: z.number(),
});

export const top5Schema = z.object({
  mostCommits: z.array(top5EntrySchema),
  mostPullRequestsOpened: z.array(top5EntrySchema),
  mostPullRequestsReviewed: z.array(top5EntrySchema),
  mostCommentsWritten: z.array(top5EntrySchema),
  busiestDaysByCommits: z.array(busiestDaySchema),
});

export const milestoneSchema = z.object({
  date: z.string(),
  title: z.string(),
  description: z.string(),
  icon: z.string(),
});

export const projectStatsSchema = z.object({
  totalCommits: z.number(),
  totalPullRequests: z.number(),
  totalReviews: z.number(),
  totalComments: z.number(),
  totalBugsFixed: z.number(),
  totalStoryPointsDone: z.number(),
  sprintsCompleted: z.number(),
});

export const projectWrappedDataSchema = z.object({
  projectName: z.string(),
  version: z.string(),
  dateRange: z.object({
    start: z.string(),
    end: z.string(),
  }),
  stats: projectStatsSchema,
  contributors: z.array(contributorSchema),
  modules: z.array(moduleSchema),
  top5: top5Schema,
  highlights: z.array(z.string()),
  milestones: z.array(milestoneSchema),
});

export type Contributor = z.infer<typeof contributorSchema>;
export type Module = z.infer<typeof moduleSchema>;
export type Top5Entry = z.infer<typeof top5EntrySchema>;
export type BusiestDay = z.infer<typeof busiestDaySchema>;
export type Top5 = z.infer<typeof top5Schema>;
export type Milestone = z.infer<typeof milestoneSchema>;
export type ProjectStats = z.infer<typeof projectStatsSchema>;
export type ProjectWrappedData = z.infer<typeof projectWrappedDataSchema>;

export const savedWrapped = pgTable("saved_wrapped", {
  id: varchar("id", { length: 16 }).primaryKey(),
  projectName: text("project_name").notNull(),
  data: jsonb("data").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertSavedWrappedSchema = createInsertSchema(savedWrapped).omit({ createdAt: true });
export type InsertSavedWrapped = z.infer<typeof insertSavedWrappedSchema>;
export type SavedWrapped = typeof savedWrapped.$inferSelect;
