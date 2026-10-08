# GitHub AI Manager

A Vercel-ready AI GitHub management dashboard using OpenRouter and the GitHub REST API.

## Features

- Natural-language GitHub management
- Repository listing
- Repository inspection
- File reading
- File create/update + commit
- File deletion
- Repository creation
- Branch creation
- Pull request creation
- Pull request merge
- Repository deletion with confirmation
- Mobile-friendly UI

## 1. Install

```bash
npm install
npm run dev
```

## 2. Environment variables

Create `.env.local`:

```env
OPENROUTER_API_KEY=your_openrouter_key
OPENROUTER_MODEL=your_openrouter_model_id
GITHUB_TOKEN=your_github_token
```

Do NOT commit `.env.local`.

## 3. GitHub token

Create a GitHub token with only the permissions you actually need. For full repository management, the token needs appropriate repository read/write and administration permissions. Prefer fine-grained tokens and avoid broad permissions when possible.

## 4. OpenRouter model

Put the exact model ID supported by your OpenRouter account in `OPENROUTER_MODEL`.

## 5. Deploy to Vercel

Push this project to GitHub, import the repository into Vercel, then add:

- `OPENROUTER_API_KEY`
- `OPENROUTER_MODEL`
- `GITHUB_TOKEN`

to Vercel Environment Variables.

Redeploy after adding/changing environment variables.

## Security

- Secrets are server-side only.
- `.env.local` is ignored by Git.
- Never paste secrets into the chat UI.
- Destructive operations require explicit confirmation.
- This is a personal admin dashboard; add authentication before exposing it publicly.

## Important

If you deploy this publicly without adding authentication, anyone who can reach the dashboard could potentially use your configured GitHub token through the application. Put authentication/rate limiting in front of the dashboard before public use.
