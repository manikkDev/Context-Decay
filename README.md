# Knowledge Decay Detector

A browser-only tool that extracts assumptions from text/URLs and scores how stale they are against curated reality anchors.

## Live demo

### Vercel

1. Import the repo into Vercel.
2. Add the environment variables listed below.
3. Deploy.
4. Open:
   - `/demo` for the guided runner
   - `/analyze` for ad-hoc analysis

## Local setup

### 1) Install

```bash
npm install
```

### 2) Environment variables

Create `.env.local` in the project root.

Required for Firebase (Cloud Firestore + Auth):

```bash
VITE_FIREBASE_API_KEY=
VITE_FIREBASE_AUTH_DOMAIN=
VITE_FIREBASE_PROJECT_ID=
VITE_FIREBASE_STORAGE_BUCKET=
VITE_FIREBASE_MESSAGING_SENDER_ID=
VITE_FIREBASE_APP_ID=
```

Optional for Gemini:

```bash
VITE_GEMINI_API_KEY=
VITE_GEMINI_ENDPOINT=
```

### 3) Run the app

```bash
npm run dev
```

Routes:

- `/` landing
- `/demo` demo runner
- `/analyze` analyzer UI

## Demo mode

1. Start the app with `npm run dev`.
2. Open `http://localhost:5173/demo`.
3. Click Run and step through the 3 curated examples.
4. Toggle Presentation mode for a cleaner “on stage” view.

## Seeding reality anchors to Firestore

Reality anchors live in `src/data/reality-seed.json`.

1. Ensure your Firebase project has Authentication enabled (Anonymous Auth is sufficient for seeding).
2. Ensure your Firestore rules are deployed and permit writes for authenticated users.
3. Run:

```bash
npm run firestore:seed-anchors
```

## Toggle Gemini simulation mode

Gemini runs in simulated mode unless both `VITE_GEMINI_API_KEY` and `VITE_GEMINI_ENDPOINT` are non-empty.

- Simulated: leave either variable empty in `.env.local`, restart `npm run dev`.
- Live: set both variables, restart `npm run dev`.

## Deploy

### Vercel

1. Push to GitHub.
2. Create a Vercel project from the repo.
3. Set the environment variables listed above.
4. Vercel builds with `npm run build` and serves `dist`.

### Firebase Hosting

1. Install Firebase CLI.
2. Run `firebase init hosting` and set the public directory to `dist`.
3. Build: `npm run build`
4. Deploy: `firebase deploy`

## Firestore rules

This repo includes demo-oriented Firestore rules in `firestore.rules`. Before production, tighten access (for example: restrict `realityAnchors` writes to admin-claimed users, remove any dev-open access, and review `analysisSessions` access) and deploy rules with the Firebase CLI.

## Hackathon checklist

- 3 demo scenarios: curated runner (`/demo`), ad-hoc analysis (`/analyze`), Firestore verification + inspector
- 1 technical slide: scoring model + escalation logic overview
- 1 architecture slide: Vite/React UI, local extraction/scoring, optional Gemini, Firestore persistence
