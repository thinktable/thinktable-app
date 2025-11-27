# Thinkable App

Frontend web application for Thinkable - AI Chat for Visual Mind Mapping.

## Features

- **Home Page** (`/`) - Hero section with key features and call-to-action
- **Product Page** (`/product`) - Interactive React Flow showcases demonstrating use cases:
  - Brainstorming sessions → Visual mind maps
  - Meeting notes → Workflow diagrams
  - Research topics → Interconnected concept maps

## Tech Stack

- **Next.js 15** (App Router) with TypeScript
- **React Flow** - Interactive diagramming and mind mapping
- **Tailwind CSS** - Styling
- **TypeScript** - Type safety

## Setup

1. **Install dependencies**:
   ```bash
   npm install
   ```

2. **Set up environment variables**:
   Copy `env.local.example` to `.env.local` and fill in your values:
   ```bash
   cp env.local.example .env.local
   ```

3. **Run the development server**:
   ```bash
   npm run dev
   ```

4. **Open [http://localhost:3031](http://localhost:3031)** in your browser

## Port Configuration

The app runs on port **3031** by default (configured in `package.json` scripts).

## Project Structure

```
├── app/
│   ├── page.tsx          # Home page (/)
│   ├── product/
│   │   └── page.tsx      # Product page with React Flow showcases
│   ├── layout.tsx        # Root layout
│   └── globals.css       # Global styles
├── package.json
└── tsconfig.json
```

## React Flow Features

The product page showcases three interactive use cases using React Flow:

1. **Brainstorming** - Shows how AI chat transforms into connected idea nodes
2. **Meeting Notes** - Demonstrates extraction of action items into workflow diagrams
3. **Research Topics** - Visualizes hierarchical organization of research concepts

Each showcase is fully interactive - you can pan, zoom, and explore the diagrams.

## Coming Soon

- React Flow Pro features integration
- Custom node types
- Advanced layout algorithms
- Real-time collaboration
