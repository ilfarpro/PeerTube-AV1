# PeerTube runner

Runner program to execute jobs (transcoding...) of remote PeerTube instances.

This version of runner designed specifically for High Quality SVT-AV1 transcoding.

You can use this runner in Docker using ilfarpro/peertube-runner-av1-hq image.

Otherwise it is highly recommended to use it with latest version of FFMPEG containing SVT-AV1 ≥ v2.3.0, which is minimum required version.

SVT-AV1-PSY is incompatible with this runner yet, because it won't encode with fast-decode=2 parameter.

---

Commands below has to be run at the root of PeerTube git repository.

## Dev

### Install dependencies

```bash
cd peertube-root
yarn install --pure-lockfile
cd apps/peertube-runner && yarn install --pure-lockfile
```

### Develop

```bash
cd peertube-root
npm run dev:peertube-runner
```

### Build

```bash
cd peertube-root
npm run build:peertube-runner
```

### Run

```bash
cd peertube-root
node apps/peertube-runner/dist/peertube-runner.js --help
```

### Publish on NPM

```bash
cd peertube-root
(cd apps/peertube-runner && npm version patch) && npm run build:peertube-runner && (cd apps/peertube-runner && npm publish --access=public)
```
