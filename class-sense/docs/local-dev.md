# Local development with Firebase Emulator

Better Auth + Prisma remain the system authentication and relational data path.
The Firebase Emulator setup here is for upcoming Firestore/HCI realtime lane work in v2.

## Native emulator quickstart

1. Install dependencies:

   ```bash
   npm install
   ```

2. Start Firebase emulators locally:

   ```bash
   npm run emulator:start
   ```

3. Optional: persist data between runs:

   ```bash
   npm run emulator:start:import
   ```

Emulator ports:

- Firestore: `8080`
- Auth emulator: `9099`
- Emulator UI: `4000`

## Docker fallback quickstart

1. Start containerized emulator stack:

   ```bash
   npm run emulator:docker
   ```

2. Stop and remove container:

   ```bash
   npm run emulator:docker:down
   ```

Data is persisted via the named Docker volume `firebase-emulator-data` and mounted at `./.firebase-data`.

## Required environment variables

Set these for Next.js and Python workers when targeting local emulators:

```env
FIRESTORE_EMULATOR_HOST=127.0.0.1:8080
FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099
GOOGLE_CLOUD_PROJECT=demo-classsense
```

If running inside Docker networking, use the reachable host/port for your runtime.

## Firebase SDK variables (Next.js + Admin)

Add these values to `.env.local` (or `.env.development.local`) when enabling realtime dashboard snapshots:

```env
NEXT_PUBLIC_FIREBASE_API_KEY=...
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=...
NEXT_PUBLIC_FIREBASE_PROJECT_ID=...
NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET=...
NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=...
NEXT_PUBLIC_FIREBASE_APP_ID=...

# Optional when using service-account credentials explicitly
FIREBASE_PROJECT_ID=...
FIREBASE_CLIENT_EMAIL=...
FIREBASE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n"
```

If service-account variables are not set, server code will fall back to `applicationDefault()` credentials.
