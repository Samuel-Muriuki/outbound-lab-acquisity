#!/usr/bin/env bash
# OutboundLab — One-shot bootstrap script
# Run from repo root. Idempotent: safe to re-run.

set -e

echo "🎉  OutboundLab bootstrap starting..."
echo

# 1. Verify we're in the right place
if [ ! -f "PLANNING-BRIEF.md" ]; then
  echo "❌  PLANNING-BRIEF.md not found. Run this from the outbound-lab repo root."
  exit 1
fi

# 2. Set git author
echo "🔧  Configuring git author..."
git config user.name "Samuel Muriuki"
git config user.email "sammkimberly@gmail.com"

# 3. Initialize git if not already initialized
if [ ! -d ".git" ]; then
  echo "🎉  Initializing git repository..."
  git init -b main
  git commit --allow-empty -m "🎉 chore: initial project setup"
  git checkout -b develop
fi

# 4. Verify .env.local exists
if [ ! -f ".env.local" ]; then
  echo "⚠️   .env.local not found. Copying from .env.example..."
  cp .env.example .env.local
  echo "    👉  Edit .env.local with real keys before running 'pnpm dev'."
fi

# 5. Verify Node and pnpm
NODE_VERSION=$(node -v 2>/dev/null || echo "none")
if [[ "$NODE_VERSION" == "none" ]]; then
  echo "❌  Node not found. Install Node 20+ from https://nodejs.org"
  exit 1
fi
echo "✅  Node version: $NODE_VERSION"

if ! command -v pnpm >/dev/null 2>&1; then
  echo "❌  pnpm not found. Install with: npm install -g pnpm  (or see https://pnpm.io/installation)"
  exit 1
fi
echo "✅  pnpm version: $(pnpm -v)"

# 6. Initialize Next.js if package.json doesn't exist
if [ ! -f "package.json" ]; then
  echo "🔧  Initializing Next.js 15 with TypeScript strict + Tailwind + App Router..."
  pnpm dlx create-next-app@latest . \
    --typescript \
    --tailwind \
    --app \
    --src-dir \
    --eslint \
    --import-alias "@/*" \
    --use-pnpm \
    --no-turbopack
fi

# 7. Install runtime dependencies (idempotent)
echo "📦  Installing runtime dependencies..."
pnpm add \
  openai \
  @google/generative-ai \
  @supabase/supabase-js \
  zod \
  next-themes \
  lucide-react \
  class-variance-authority \
  clsx \
  tailwind-merge

echo "📦  Installing dev dependencies..."
pnpm add -D \
  @types/node \
  vitest \
  @vitejs/plugin-react \
  @playwright/test \
  prettier

# 8. Install shadcn/ui (manual — agent will run these on first feature PR)
echo "ℹ️   shadcn/ui will be initialized in PR 1 by Claude Code (pnpm dlx shadcn@latest init)."

# 9. Verify .ai and .claude folders exist (already in repo via this kit, but kept gitignored)
mkdir -p .ai/docs .ai/assessments .ai/conventions
mkdir -p .claude/memory .claude/skills .claude/session-notes

# 10. Add pnpm scripts if missing
if ! grep -q "\"typecheck\"" package.json; then
  echo "🔧  Adding typecheck and test scripts..."
  pnpm pkg set scripts.typecheck="tsc --noEmit"
  pnpm pkg set scripts.test="vitest run"
  pnpm pkg set scripts.test:watch="vitest"
  pnpm pkg set scripts.test:e2e="playwright test"
  pnpm pkg set scripts.format="prettier --write \"**/*.{ts,tsx,md,json}\""
fi

echo
echo "✅  Bootstrap complete."
echo
echo "Next steps:"
echo "  1. Copy .env.example → .env.local and fill in:"
echo "     - GROQ_API_KEY        (https://console.groq.com)"
echo "     - GEMINI_API_KEY      (https://aistudio.google.com/app/apikey)"
echo "     - OPENROUTER_API_KEY  (https://openrouter.ai)"
echo "     - TAVILY_API_KEY      (https://tavily.com)"
echo "     - Supabase keys       (https://supabase.com — Singapore region)"
echo "  2. Push to GitHub:"
echo "       git remote add origin git@github.com:Samuel-Muriuki/outbound-lab-acquisity.git"
echo "       git push -u origin main"
echo "       git push -u origin develop"
echo "  3. Run: pnpm dev"
echo "  4. Open: http://localhost:3000"
echo "  5. Open Claude Code in this folder and start SESSION 1 from BUILD-PLAN.md"
echo
