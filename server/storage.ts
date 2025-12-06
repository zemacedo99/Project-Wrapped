import { type User, type InsertUser, type ProjectWrappedData, savedWrapped, users } from "@shared/schema";
import { db } from "./db";
import { eq } from "drizzle-orm";
import { randomBytes } from "crypto";

export interface SavedWrappedResult {
  id: string;
  projectName: string;
  data: ProjectWrappedData;
  createdAt: Date;
}

export interface IStorage {
  getUser(id: string): Promise<User | undefined>;
  getUserByUsername(username: string): Promise<User | undefined>;
  createUser(user: InsertUser): Promise<User>;
  getProjectWrappedData(): Promise<ProjectWrappedData>;
  saveWrapped(data: ProjectWrappedData): Promise<SavedWrappedResult>;
  getSavedWrapped(id: string): Promise<SavedWrappedResult | undefined>;
}

function generateId(): string {
  return randomBytes(8).toString("hex").substring(0, 12);
}

export class DatabaseStorage implements IStorage {
  async getUser(id: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.id, id));
    return user;
  }

  async getUserByUsername(username: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.username, username));
    return user;
  }

  async createUser(insertUser: InsertUser): Promise<User> {
    const [user] = await db.insert(users).values(insertUser).returning();
    return user;
  }

  async getProjectWrappedData(): Promise<ProjectWrappedData> {
    return loadData();
  }

  async saveWrapped(data: ProjectWrappedData): Promise<SavedWrappedResult> {
    const id = generateId();
    const [saved] = await db.insert(savedWrapped).values({
      id,
      projectName: data.projectName,
      data,
    }).returning();
    
    return {
      id: saved.id,
      projectName: saved.projectName,
      data: saved.data as ProjectWrappedData,
      createdAt: saved.createdAt,
    };
  }

  async getSavedWrapped(id: string): Promise<SavedWrappedResult | undefined> {
    const [saved] = await db.select().from(savedWrapped).where(eq(savedWrapped.id, id));
    if (!saved) return undefined;
    
    return {
      id: saved.id,
      projectName: saved.projectName,
      data: saved.data as ProjectWrappedData,
      createdAt: saved.createdAt,
    };
  }
}

export const storage = new DatabaseStorage();

export function loadData(): ProjectWrappedData {
  return {
    projectName: "DVOI – DaVinci On Iris",
    version: "1.0",
    dateRange: {
      start: "2023-01-01",
      end: "2025-12-31",
    },

    stats: {
      totalCommits: 2847,
      totalPullRequests: 423,
      totalReviews: 1256,
      totalComments: 3891,
      totalBugsFixed: 187,
      totalStoryPointsDone: 892,
      sprintsCompleted: 24,
    },

    contributors: [
      {
        name: "Sarah Chen",
        commits: 892,
        pullRequestsOpened: 134,
        pullRequestsReviewed: 412,
        commentsWritten: 1245,
        bugsFixed: 67,
        storyPointsDone: 234,
      },
      {
        name: "Marcus Johnson",
        commits: 756,
        pullRequestsOpened: 98,
        pullRequestsReviewed: 289,
        commentsWritten: 876,
        bugsFixed: 45,
        storyPointsDone: 198,
      },
      {
        name: "Elena Rodriguez",
        commits: 612,
        pullRequestsOpened: 87,
        pullRequestsReviewed: 334,
        commentsWritten: 923,
        bugsFixed: 38,
        storyPointsDone: 187,
      },
      {
        name: "Alex Kim",
        commits: 387,
        pullRequestsOpened: 62,
        pullRequestsReviewed: 156,
        commentsWritten: 534,
        bugsFixed: 24,
        storyPointsDone: 156,
      },
      {
        name: "Jordan Taylor",
        commits: 200,
        pullRequestsOpened: 42,
        pullRequestsReviewed: 65,
        commentsWritten: 313,
        bugsFixed: 13,
        storyPointsDone: 117,
      },
    ],

    modules: [
      {
        name: "Core Engine",
        commits: 892,
        pullRequests: 134,
        storyPointsDone: 289,
        status: "Complete",
      },
      {
        name: "API Gateway",
        commits: 567,
        pullRequests: 89,
        storyPointsDone: 178,
        status: "Complete",
      },
      {
        name: "User Interface",
        commits: 723,
        pullRequests: 112,
        storyPointsDone: 234,
        status: "Complete",
      },
      {
        name: "Data Pipeline",
        commits: 345,
        pullRequests: 54,
        storyPointsDone: 112,
        status: "In Progress",
      },
      {
        name: "Analytics Dashboard",
        commits: 320,
        pullRequests: 34,
        storyPointsDone: 79,
        status: "Complete",
      },
    ],

    top5: {
      mostCommits: [
        { name: "Sarah Chen", commits: 892 },
        { name: "Marcus Johnson", commits: 756 },
        { name: "Elena Rodriguez", commits: 612 },
        { name: "Alex Kim", commits: 387 },
        { name: "Jordan Taylor", commits: 200 },
      ],
      mostPullRequestsOpened: [
        { name: "Sarah Chen", pullRequestsOpened: 134 },
        { name: "Marcus Johnson", pullRequestsOpened: 98 },
        { name: "Elena Rodriguez", pullRequestsOpened: 87 },
        { name: "Alex Kim", pullRequestsOpened: 62 },
        { name: "Jordan Taylor", pullRequestsOpened: 42 },
      ],
      mostPullRequestsReviewed: [
        { name: "Sarah Chen", pullRequestsReviewed: 412 },
        { name: "Elena Rodriguez", pullRequestsReviewed: 334 },
        { name: "Marcus Johnson", pullRequestsReviewed: 289 },
        { name: "Alex Kim", pullRequestsReviewed: 156 },
        { name: "Jordan Taylor", pullRequestsReviewed: 65 },
      ],
      mostCommentsWritten: [
        { name: "Sarah Chen", commentsWritten: 1245 },
        { name: "Elena Rodriguez", commentsWritten: 923 },
        { name: "Marcus Johnson", commentsWritten: 876 },
        { name: "Alex Kim", commentsWritten: 534 },
        { name: "Jordan Taylor", commentsWritten: 313 },
      ],
      busiestDaysByCommits: [
        { date: "2024-03-15", commits: 47 },
        { date: "2024-06-22", commits: 43 },
        { date: "2024-09-10", commits: 39 },
        { date: "2024-11-28", commits: 36 },
        { date: "2025-01-08", commits: 34 },
      ],
    },

    highlights: [
      "Shipped Core Engine v1.0 ahead of schedule",
      "Zero critical bugs in production for 30 days",
      "Reduced API response time by 60%",
      "Achieved 98% test coverage across all modules",
      "Successfully migrated 1M+ user records",
      "Launched beta to 500 early adopters",
    ],

    milestones: [
      {
        date: "2023-01-15",
        title: "Project Kickoff",
        description: "Team assembled and vision defined",
        icon: "rocket",
      },
      {
        date: "2023-06-01",
        title: "First Prototype",
        description: "Core functionality demonstrated",
        icon: "lightbulb",
      },
      {
        date: "2024-02-15",
        title: "Alpha Release",
        description: "Internal testing begins",
        icon: "flag",
      },
      {
        date: "2024-08-01",
        title: "Big Refactor",
        description: "Architecture overhaul for scale",
        icon: "refresh",
      },
      {
        date: "2025-06-01",
        title: "Feature Freeze",
        description: "Focus on stability and polish",
        icon: "lock",
      },
      {
        date: "2025-12-01",
        title: "1.0 Release",
        description: "Production ready!",
        icon: "party",
      },
    ],
  };
}
