# DVOI Project Wrapped - Replit Configuration

## Overview

This is a "Spotify Wrapped" style web application that presents an annual summary for the DVOI (DaVinci On Iris) project. The application showcases project statistics, contributor achievements, module progress, and milestones through an engaging, slide-based presentation with smooth animations and vibrant visuals inspired by Spotify's year-end review aesthetic.

The application is built as a full-stack TypeScript project with a React frontend and Express backend, currently using in-memory storage for data with the infrastructure ready to integrate with Azure DevOps or Git repositories in the future.

## User Preferences

Preferred communication style: Simple, everyday language.

## System Architecture

### Frontend Architecture

**Framework & Build System:**
- React 18 with TypeScript using Vite as the build tool
- Client-side routing via Wouter (lightweight React Router alternative)
- Single-page application with slide-based navigation

**UI Component System:**
- shadcn/ui component library with Radix UI primitives
- Tailwind CSS for styling with custom design tokens
- "New York" style variant with dark theme optimized for the Wrapped aesthetic
- Custom CSS variables for theming (primary purple-pink gradients, accent colors)

**State Management & Data Fetching:**
- TanStack Query (React Query) for server state management
- Custom hooks for animations (`useAnimatedCounter`, `useIntersectionObserver`)
- Intersection Observer API for scroll-triggered animations and section tracking

**Design System:**
- Bold, celebratory aesthetic with large typography (text-5xl to text-9xl)
- Gradient-based color scheme (primary: purple-to-pink, secondary: blue-to-cyan)
- Dark background (#0a0a0a to #1a1a1a) with vibrant accent overlays
- Slide-based storytelling with full-viewport sections
- Count-up animations for statistics with easing functions

### Backend Architecture

**Server Framework:**
- Express.js with TypeScript
- HTTP server setup (ready for WebSocket upgrades if needed)
- Middleware: JSON parsing, URL encoding, request logging

**API Design:**
- RESTful endpoint structure
- Single primary endpoint: `GET /api/wrapped` for project data
- Error handling with appropriate HTTP status codes
- Request/response logging with timestamps

**Data Layer:**
- Interface-based storage abstraction (`IStorage`)
- Current implementation: In-memory storage (`MemStorage`)
- Schema defined with Zod for runtime validation
- Ready for database integration (Drizzle ORM configured for PostgreSQL)

**Rationale:** The storage abstraction allows easy migration from in-memory to database persistence without changing business logic. The simple API surface reflects the read-only nature of the "wrapped" presentation.

### Build & Deployment

**Development Workflow:**
- Vite dev server with HMR (Hot Module Replacement)
- Vite middleware mode integrated with Express
- TypeScript compilation with path aliases (`@/*`, `@shared/*`)

**Production Build:**
- Custom build script using esbuild for server bundling
- Selective dependency bundling (allowlist approach) to reduce syscalls
- Vite production build for client assets
- Static file serving from Express in production

**Rationale:** The dual-build approach optimizes for development speed (Vite HMR) and production performance (bundled server with minimal dependencies).

### Data Schema

**Type System:**
- Zod schemas for runtime validation (`shared/schema.ts`)
- Drizzle schema definitions for future database integration
- Type inference using Zod and Drizzle for compile-time safety

**Core Data Structures:**
- `ProjectWrappedData`: Top-level container with project metadata, stats, contributors, modules, timeline
- `ProjectStats`: Aggregate metrics (commits, PRs, reviews, story points, sprints)
- `Contributor`: Individual contributor metrics and achievements
- `Module`: Module-specific progress and status
- `Top5`: Leaderboard rankings across different categories
- `Milestone`: Timeline events with dates and descriptions

**Rationale:** Strong typing throughout the stack prevents data mismatches between frontend and backend. Zod provides runtime safety while maintaining TypeScript compatibility.

### Animation & Interaction

**Scroll-Based Animations:**
- Intersection Observer for detecting visible sections
- Staggered entrance animations with CSS transitions
- Active section tracking for navigation dots

**Count-Up Animations:**
- Custom hook with easing functions (ease-out-quart)
- Configurable duration and delays for orchestrated reveals
- RequestAnimationFrame for smooth 60fps animations

**Rationale:** Animations are central to the "Wrapped" experience. Using Intersection Observer ensures animations trigger at the right scroll position, while custom hooks provide reusable animation logic across components.

## External Dependencies

### UI & Styling
- **Radix UI**: Unstyled, accessible component primitives (dialogs, dropdowns, tooltips, etc.)
- **shadcn/ui**: Pre-built component library built on Radix UI
- **Tailwind CSS**: Utility-first CSS framework with custom configuration
- **class-variance-authority**: Type-safe component variants
- **Lucide React**: Icon library for UI elements

### State Management & Forms
- **TanStack Query**: Asynchronous state management for server data
- **React Hook Form**: Form state management (infrastructure ready)
- **Zod**: Schema validation and type inference

### Backend & Database
- **Express**: Web server framework
- **Drizzle ORM**: Type-safe SQL query builder (configured for PostgreSQL, not yet connected)
- **pg**: PostgreSQL client library (ready for database integration)
- **connect-pg-simple**: PostgreSQL session store (ready for session management)

### Development Tools
- **Vite**: Build tool and dev server
- **esbuild**: Fast JavaScript bundler for production
- **tsx**: TypeScript execution engine for development
- **TypeScript**: Type system and compiler

### Replit Integration
- **@replit/vite-plugin-runtime-error-modal**: Error overlay for development
- **@replit/vite-plugin-cartographer**: Development tools (conditional)
- **@replit/vite-plugin-dev-banner**: Development banner (conditional)

**Future Integration Points:**
- Azure DevOps API or Git integration for real project data (currently using placeholder data)
- PostgreSQL database connection via Drizzle ORM (schema and config ready)
- Session management for multi-user scenarios (infrastructure in place)