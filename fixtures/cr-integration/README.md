# Pida 0.8.5 inbound-CR evidence

`consumer-lock.json` fixes the exact external source bytes used by the opt-in runner. Persona is a local working-tree snapshot based on the reported baseline; Schumpeter is its exact committed source. No external app source is vendored in this directory. The runner copies only verified package source into a temporary import directory, uses Python `-I -B`, never imports the deployed app and creates only synthetic/disposable databases.

```sh
npm run build
node scripts/cr-integration-check.mjs \
  --persona /absolute/path/to/vera-substrate-checkout \
  --schumpeter /absolute/path/to/schumpeter-checkout \
  --output /absolute/path/to/empty-evidence-directory
```

A source-pin mismatch stops the probe. Do not replace the lock to hide an incompatibility; review a new producer revision and create new evidence. The tests use real Pi and real local provider/consumer logic with scripted model decisions and synthetic data. The Persona shim's private validation calls are test-only; a public remote revalidation port remains requested.

`evidence/report.json` records exact source/build hashes, input/output file hashes, executed checks and limitations. Host input fingerprints can be compared within their source scope but their private HMAC key and raw real prompts are not exported. Current Schumpeter rejection is recorded as **BLOCKED_CONSUMER_CONTRACT**, even when the test checking that failure passes. Neither branch type labels nor successful model responses establish an organization/verifier controller.
