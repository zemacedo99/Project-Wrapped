# Project-Wrapped

A **Spotify Wrapped-style** web application that visualizes your Azure DevOps project statistics in an engaging, interactive presentation.

## What is this?

Project-Wrapped takes your Azure DevOps data and transforms it into a beautiful "year in review" experience, similar to Spotify Wrapped. It shows your team's achievements, top contributors, busiest days, and key milestones in an animated slideshow format.

## Features

- 📊 **Global Stats** - Total commits, PRs, code reviews, comments, bugs fixed, story points
- 🏆 **Champions** - Top 10 contributors ranked by activity
- 📁 **Modules** - Breakdown by project areas/teams
- 🥇 **Top 5 Rankings** - Most commits, most PRs, most reviews, busiest days
- ⭐ **Highlights** - Auto-generated achievements (e.g., "3,341 commits pushed")
- 📅 **Timeline** - Key milestones throughout the period
- 🎨 **Interactive UI** - Animated slides with smooth transitions

## Data Sources

Connects to Azure DevOps (cloud or on-premises) and fetches:
- Git commits from all repositories
- Pull requests with reviewer data
- PR discussion comments
- Work items (Bugs, Features, Test Cases, Requirements, etc.)
- File change history

## Tech Stack

- **Frontend**: React, TypeScript, Vite, Tailwind CSS, Radix UI
- **Backend**: Express.js, TypeScript
- **Database**: PostgreSQL with Drizzle ORM
- **API**: Azure DevOps REST API

## Prerequisites

- Node.js 18+
- PostgreSQL database
- Azure DevOps Personal Access Token (PAT) with permissions:
  - Code (Read)
  - Work Items (Read)

## Quick Start

### 1. Clone and Install

```bash
git clone https://github.com/zemacedo99/Project-Wrapped.git
cd Project-Wrapped
npm install
```

### 2. Configure Environment

Create a `.env` file:

```env
DATABASE_URL=postgresql://postgres:password@localhost:5432/project_wrapped
SESSION_SECRET=your-secret-key
NODE_ENV=development
```

### 3. Setup Database

```bash
# Start PostgreSQL (if using Docker)
docker run --name project-wrapped-db -e POSTGRES_PASSWORD=password -e POSTGRES_DB=project_wrapped -p 5432:5432 -d postgres

# Push schema
npm run db:push
```

### 4. Run Development Server

```bash
# Windows (recommended)
.\start-dev.bat

# Or manually
npm run dev
```

### 5. Open the App

Navigate to `http://localhost:5000`

## Usage

### Creating a Wrapped Project

1. Open the app in your browser
2. Enter your Azure DevOps details:
   - **Organization/Collection**: Your Azure DevOps organization name (e.g., "MyOrg")
   - **Project**: Project name (e.g., "MyProject")
   - **Personal Access Token**: Your PAT with Code and Work Items read permissions
   - **Base URL** (optional): For on-premises servers (e.g., `https://tfs.mycompany.com/`)
   - **Date Range** (optional): Filter to specific time period
3. Click "Create Wrapped"
4. Watch your project's story unfold!

### API Endpoints

```bash
# Create a wrapped project
POST /api/connect/azure-devops
{
  "organization": "MyOrg",
  "project": "MyProject",
  "personalAccessToken": "your-pat-token",
  "baseUrl": "https://dev.azure.com/",  # optional
  "dateFrom": "2024-01-01",              # optional
  "dateTo": "2024-12-31"                 # optional
}

# Get wrapped project data
GET /api/wrapped/{project-id}
```

## Project Structure

```
Project-Wrapped/
├── client/                 # React frontend
│   └── src/
│       ├── components/     # UI components
│       │   └── slides/     # Wrapped presentation slides
│       ├── pages/          # Page components
│       └── hooks/          # Custom React hooks
├── server/                 # Express backend
│   ├── services/
│   │   └── azure-devops.ts # Azure DevOps API integration
│   └── routes.ts           # API routes
├── shared/                 # Shared types/schemas
│   └── schema.ts           # Database schema & types
└── start-dev.bat           # Windows development startup script
```

## Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Start development server |
| `npm run build` | Build for production |
| `npm start` | Run production build |
| `npm run check` | TypeScript type checking |
| `npm run db:push` | Push database schema changes |

## Azure DevOps API Endpoints Used

| Endpoint | Purpose |
|----------|---------|
| `/git/repositories` | List all repositories |
| `/git/repositories/{id}/commits` | Get commits |
| `/git/repositories/{id}/pullrequests` | Get pull requests |
| `/git/repositories/{id}/pullrequests/{id}/threads` | Get PR comments |
| `/wit/wiql` | Query work items |
| `/wit/workitems` | Get work item details |

## Troubleshooting

### Database Connection Error
- Verify PostgreSQL is running
- Check `DATABASE_URL` in `.env`
- Run `npm run db:push` to initialize schema

### Azure DevOps Authentication Error
- Verify PAT has correct permissions (Code: Read, Work Items: Read)
- Check organization and project names are correct
- For on-premises, ensure `baseUrl` is set correctly

### SSL Certificate Error (On-Premises)
- The app automatically disables SSL verification for on-premises servers with self-signed certificates

## License

MIT

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Run `npm run check` to verify TypeScript
5. Submit a pull request

## Author

Created by [@zemacedo99](https://github.com/zemacedo99)
