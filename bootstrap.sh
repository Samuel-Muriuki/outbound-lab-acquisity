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
  git init
  git checkout -b main
  git commit --allow-empty -m "🎉 chore: initial project setup"
  git checkout -b develop
fi

# 4. Verify .env.local exists
if [ ! -f ".env.local" ]; then
  echo "⚠️   .env.local not found. Copying from .env.example..."
  cp .env.example .env.local
  echo "    👉  Edit .env.local with real keys before running 'npm run dev'."
fi

# 5. Verify Node version
NODE_VERSION=$(node -v 2>/dev/null || echo "none")
if [[ "$NODE_VERSION" == "none" ]]; then
  echo "❌  Node not found. Install Node 20+ from https://nodejs.org"
  exit 1
fi
echo "✅  Node version: $NODE_VERSION"

# 6. Initialize Next.js if package.json doesn't exist
if [ ! -f "package.json" ]; then
  echo "🔧  Initializing Next.js 15 with TypeScript strict + Tailwind + App Router..."
  npx create-next-app@latest . \
    --typescript \
    --tailwind \
    --app \
    --src-dir \
    --eslint \
    --import-alias "@/*" \
    --use-npm \
    --no-turbopack
fi

# 7. Install core dependencies (idempotent)
echo "📦  Installing core dependencies..."
npm install \
  openai \
  @supabase/supabase-js \
  zod \
  next-themes \
  lucide-react \
  class-variance-authority \
  clsx \
  tailwind-merge

echo "📦  Installing dev dependencies..."
npm install -D \
  @types/node \
  vitest \
  @vitejs/plugin-react \
  @playwright/test \
  prettier

# 8. Install shadcn/ui (manual — agent will run these on first feature PR)
echo "ℹ️   shadcn/ui will be initialized in PR 1 by Claude Code (npx shadcn@latest init)."

# 9. Verify .ai and .claude folders exist (already in repo via this kit)
mkdir -p .ai/docs .ai/assessments .ai/conventions
mkdir -p .claude/memory .claude/skills .claude/session-notes

# 10. Add npm scripts if missing
if ! grep -q "\"typecheck\"" package.json; then
  echo "🔧  Adding typecheck and test scripts..."
  npm pkg set scripts.typecheck="tsc --noEmit"
  npm pkg set scripts.test="vitest run"
  npm pkg set scripts.test:watch="vitest"
  npm pkg set scripts.test:e2e="playwright test"
  npm pkg set scripts.format="prettier --write \"**/*.{ts,tsx,md,json}\""
fi

echo
echo "✅  Bootstrap complete. Next steps:"
echo "   1. Fill in .env.local with real API keys"
echo "   2. Push to GitHub:  git remote add origin git@github.com:Samuel-Muriuki/outbound-lab.git"
echo "                       git push -u origin main"
echo "                       git push -u origin develop"
echo "   3. Connect to Vercel and deploy from main"
echo "   4. Open Claude Code in this folder and start SESSION 1 from BUILD-PLAN.md"
echo

# === LLM provider packages (Path B: free-tier chain) ===
# Groq + OpenRouter use OpenAI-compatible APIs → install `openai` SDK
# Gemini uses Google's official SDK
echo "==> Installing LLM provider packages..."
pnpm add openai @google/generative-ai

echo ""
echo "✓ Bootstrap complete."
echo ""
echo "Next steps:"
echo "  1. Copy .env.example → .env.local and fill in:"
echo "     - GROQ_API_KEY (https://console.groq.com)"
echo "     - GEMINI_API_KEY (https://aistudio.google.com/app/apikey)"
echo "     - OPENROUTER_API_KEY (https://openrouter.ai)"
echo "     - TAVILY_API_KEY (https://tavily.com)"
echo "     - Supabase keys (https://supabase.com)"
echo "  2. Run: pnpm dev"
echo "  3. Open: http://localhost:3000"
