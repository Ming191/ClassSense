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
