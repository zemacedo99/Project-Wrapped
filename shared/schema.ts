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
  linesAdded: z.number().optional(),
  linesDeleted: z.number().optional(),
  avgPrMergeTimeHours: z.number().optional(),
  longestStreak: z.number().optional(), // consecutive days with commits
  favoriteHour: z.number().optional(), // 0-23, hour with most commits
});

export const moduleSchema = z.object({
  name: z.string(),
  commits: z.number(),
  pullRequests: z.number(),
  storyPointsDone: z.number(),
  status: z.string(),
  bugsFixed: z.number().optional(),
  contributors: z.number().optional(),
});

export const repositoryStatsSchema = z.object({
  name: z.string(),
  commits: z.number(),
  pullRequests: z.number(),
  branches: z.number().optional(),
  contributors: z.number(),
  linesAdded: z.number().optional(),
  linesDeleted: z.number().optional(),
  topContributor: z.string().optional(),
});

export const activityPatternSchema = z.object({
  hourlyDistribution: z.array(z.number()), // 24 hours, commit counts
  dailyDistribution: z.array(z.number()), // 7 days (Sun-Sat), commit counts
  busiestHour: z.number(), // 0-23
  busiestDay: z.string(), // "Monday", "Tuesday", etc.
  peakProductivityTime: z.string(), // "Morning", "Afternoon", "Evening", "Night"
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
  mostLinesAdded: z.array(top5EntrySchema).optional(),
  longestStreaks: z.array(top5EntrySchema).optional(),
  fastestPrMergers: z.array(top5EntrySchema).optional(),
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
  // New enhanced stats
  totalLinesAdded: z.number().optional(),
  totalLinesDeleted: z.number().optional(),
  totalFilesChanged: z.number().optional(),
  totalRepositories: z.number().optional(),
  avgPrMergeTimeHours: z.number().optional(),
  fastestPrMergeTimeHours: z.number().optional(),
  longestStreak: z.number().optional(),
  totalWorkItems: z.number().optional(),
  prMergeRate: z.number().optional(), // percentage of PRs merged
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
  // New enhanced data
  repositories: z.array(repositoryStatsSchema).optional(),
  activityPattern: activityPatternSchema.optional(),
  funFacts: z.array(z.string()).optional(),
  workItemBreakdown: z.record(z.string(), z.number()).optional(), // type -> count
});

export type Contributor = z.infer<typeof contributorSchema>;
export type Module = z.infer<typeof moduleSchema>;
export type RepositoryStats = z.infer<typeof repositoryStatsSchema>;
export type ActivityPattern = z.infer<typeof activityPatternSchema>;
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
