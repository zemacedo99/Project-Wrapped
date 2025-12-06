# Project-Wrapped (Wrapped-Insights)

Description
- This repository contains the code for Wrapped-Insights (live at https://replit.com/@ZeMacedo1/Wrapped-Insights).
- It is a full‑stack TypeScript application (front-end + back-end) that provides the Wrapped-Insights web app experience. The project uses React for the client UI and an Express/TypeScript server for API/backend logic.

What this repo is for
- Hosts the Wrapped-Insights web application codebase (client and server).
- Implements API endpoints and server logic (server/index.ts).
- Manages database schema and migrations using Drizzle ORM / drizzle-kit.

Tech stack
- Language: TypeScript (primary)
- Front-end: React, Vite
- Back-end: Express (server/index.ts)
- Database/ORM: PostgreSQL + drizzle-orm (drizzle-kit)
- Auth/session: passport, express-session
- Dev tools: tsx, TypeScript, Vite

Prerequisites
- Node.js (recommended: Node 18+)
- npm
- PostgreSQL (for local DB usage) or a managed Postgres instance
- Git

Local setup
1. Clone the repository:
   git clone https://github.com/zemacedo99/Project-Wrapped.git
   cd Project-Wrapped
2. Install dependencies:
   npm install

Environment variables
Create a .env file or set environment variables required by the app. Common variables expected by projects of this structure include:
- DATABASE_URL — Postgres connection string used by drizzle / pg
- SESSION_SECRET — secret for express-session
- NODE_ENV — development or production (optional)
- PORT — server port (optional)

Check server/index.ts and other config files for any additional required variables (OAuth keys, third-party API keys, etc.).

Database
- To apply schema changes with Drizzle:
  npm run db:push
- Ensure DATABASE_URL points to a running Postgres instance before running db commands.

Run (development)
- Start the app in development with hot reload:
  npm run dev
- This runs the server entry (server/index.ts) via tsx with NODE_ENV=development. The front-end dev server (Vite) may be integrated or require a separate start depending on the project structure.

Build and run (production)
- Build:
  npm run build
- Start production server:
  npm start

Scripts (from package.json)
- npm run dev — development server (NODE_ENV=development tsx server/index.ts)
- npm run build — build for production (tsx script/build.ts)
- npm start — run production bundle (NODE_ENV=production node dist/index.cjs)
- npm run check — run TypeScript type checks (tsc)
- npm run db:push — push DB schema changes (drizzle-kit)

Replit
- The repository references a Replit project. On Replit, set the run command to:
  npm run dev
  or use the production command:
  npm start
- Add environment variables (DATABASE_URL, SESSION_SECRET, etc.) via Replit Secrets.

Troubleshooting
- If DB-related errors occur, verify DATABASE_URL and run npm run db:push.
- Sessions require SESSION_SECRET; without it, session behavior may be unstable.
- If the front-end is served separately, you may need to run the Vite dev server or adjust the run command.

License
- MIT (as declared in package.json)

Contributing
- Fork the repo, create a branch, make changes, run npm run check, and open a pull request.

Contact
- For questions about the codebase, open an issue in this repository.
