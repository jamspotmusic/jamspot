# Welcome to your Expo app 👋

This is an [Expo](https://expo.dev) project created with [`create-expo-app`](https://www.npmjs.com/package/create-expo-app).

## Get started

1. Install dependencies

   ```bash
   npm install
   ```

2. Start the app

   ```bash
   npx expo start
   ```

In the output, you'll find options to open the app in a

- [development build](https://docs.expo.dev/develop/development-builds/introduction/)
- [Android emulator](https://docs.expo.dev/workflow/android-studio-emulator/)
- [iOS simulator](https://docs.expo.dev/workflow/ios-simulator/)
- [Expo Go](https://expo.dev/go), a limited sandbox for trying out app development with Expo

You can start developing by editing the files inside the **app** directory. This project uses [file-based routing](https://docs.expo.dev/router/introduction).

## Which API the app talks to

The web app's routes under `/api` are the backend for both clients. `getApiBaseUrl`
in `src/lib/api.ts` resolves the host in descending order of specificity:

| Order | Condition | Resolves to |
| --- | --- | --- |
| 1 | `EXPO_PUBLIC_API_URL` is set | that value |
| 2 | dev build **and** a JamSpot dev server answers on `:3000` | `http://<your-machine>:3000` |
| 3 | anything else | `extra.apiUrl` in `app.json`, else production |

Case 2 is a preference, not a requirement: **the app does not need `npm run dev:web`
to run.** On startup it probes the local dev server once, and falls through to the
deployed API if nothing JamSpot-shaped answers. Start the dev server and reload to
pick it back up.

The probe checks that the response is actually JamSpot's — a success, or its
`{ error }` body shape — rather than just "something responded". Port 3000 attracts
squatters, and accepting a stray 404 from an unrelated service is how the app ends
up rendering someone else's error.

Production is `https://www.jamspotmusic.app` (Vercel behind Cloudflare). The `www`
host is deliberate: the apex 308-redirects there, and `fetch` follows it, but that
costs a round trip on every request.

**Local development.** Run `npm run dev:web` from the repo root if you want the app
talking to your local API — case 2 picks up your machine's LAN address from Metro, so
simulators, emulators, and physical devices on the same network all reach it. Skip it
and the app runs against the deployed API instead. The dev server binds port 3000 and
fails loudly if something already holds it, because the mobile client looks for that
port specifically. To move it, set `PORT` on both sides:

```bash
PORT=3007 npm run dev:web
EXPO_PUBLIC_API_URL=http://localhost:3007 npm run dev:mobile
```

**Testing against a deployed environment.** `EXPO_PUBLIC_API_URL` overrides
everything, in dev builds and release builds alike:

```bash
# preprod / subprod
EXPO_PUBLIC_API_URL=https://jamspot-three.vercel.app npm run dev:mobile

# production, from a dev build
EXPO_PUBLIC_API_URL=https://www.jamspotmusic.app npm run dev:mobile
```

For a distributable build aimed at preprod (EAS internal distribution, say), set
the same variable at build time, or point `extra.apiUrl` in `app.json` at the
environment that build should ship against.

## Get a fresh project

When you're ready, run:

```bash
npm run reset-project
```

This command will move the starter code to the **app-example** directory and create a blank **app** directory where you can start developing.

### Other setup steps

- To set up ESLint for linting, run `npx expo lint`, or follow our guide on ["Using ESLint and Prettier"](https://docs.expo.dev/guides/using-eslint/)
- If you'd like to set up unit testing, follow our guide on ["Unit Testing with Jest"](https://docs.expo.dev/develop/unit-testing/)
- Learn more about the TypeScript setup in this template in our guide on ["Using TypeScript"](https://docs.expo.dev/guides/typescript/)

## Learn more

To learn more about developing your project with Expo, look at the following resources:

- [Expo documentation](https://docs.expo.dev/): Learn fundamentals, or go into advanced topics with our [guides](https://docs.expo.dev/guides).
- [Learn Expo tutorial](https://docs.expo.dev/tutorial/introduction/): Follow a step-by-step tutorial where you'll create a project that runs on Android, iOS, and the web.

## Join the community

Join our community of developers creating universal apps.

- [Expo on GitHub](https://github.com/expo/expo): View our open source platform and contribute.
- [Discord community](https://chat.expo.dev): Chat with Expo users and ask questions.
