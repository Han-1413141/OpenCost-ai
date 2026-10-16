# OpenCost

AI work costs, subscription quota monitoring, and model value recommendations.

[Website](https://opencost-ai.com) · [简体中文](README.zh-CN.md) · [Upload Skill](skills/opencost-contribute/SKILL.md)

## What is included

| Directory | Contents |
| --- | --- |
| `web/` | Website, charts, GitHub sign-in UI, language selector |
| `desktop/` | Local work journal, Harness integration, canvas and reminders |
| `client/` | Upload CLI, SDK, quota monitoring and local adapters |
| `skills/` | Contribution Skill and collection instructions |
| `shared/` | User-side schemas, validation, previews and display dependencies |
| `docs/` | Setup, data fields and integration guides |

The repository contains the code distributed to users. Server-side aggregation, storage, authentication services, production configuration and user records are maintained separately. Local validation and preview calculations are included so the clients can run independently.

## Website

Node.js 24 is required.

```sh
npm ci
npm run dev
npm run build
```

The development UI opens at `http://127.0.0.1:4317`. Public API reads use the OpenCost service by default. Set `OPENCOST_API_PROXY` to connect to your own compatible API. Use the live website for GitHub sign-in; its OAuth callback belongs to the production domain.

The interface supports Simplified Chinese, Traditional Chinese, English and Japanese. It follows browser language and remembers manual selection. Translation files are bundled locally; changing language makes no model API call. Translation changes presentation only: schema keys, values, amounts, input fields and exported records retain their original values.

## Contribute a work summary

Read `skills/opencost-contribute/SKILL.md` in your Harness, or download the client package from the website. The workflow is: select sources and time range, collect local structured records, review the redacted preview, then upload to the selected destination.

```sh
npm run contribute -- help
npm run monitor -- help
```

The recommended initial range is three days; the maximum historical range is 90 days. Incremental collection and automation are user choices. Quota monitoring and automatic uploads start disabled. AI processing of old conversations consumes the selected model's usage; processing existing structured measurements does not call a model.

[One-time quota collection](skills/opencost-contribute/references/quota-collection.md) imports selected Codex quota logs, DSH exports or standard snapshots, and can read an existing quota API configuration once. It creates a coverage report and upload previews without starting background monitoring or calling a model. Missing history stays unknown; percentages are not converted into tokens or payments.

GitHub users can download an account credential from **My records → Connect local Harness**. Independent credentials keep their existing record ownership.

## Desktop

```sh
npm run desktop:build
npm run desktop:start
```

The app keeps journals locally, supports multiple Harnesses, and provides daily review, mind maps and an infinite canvas. The default reminder is 17:30 and can be changed in settings. This public build uses real authorized sources; the private presentation environment is maintained separately.

## Source and privacy

`source.json` pins the contribution prompts to a Git commit and records their SHA-256 hashes. Run `npm run contribute -- source --verify` to check the published files. Model credentials, browser cookies, local logs, databases, user documents and production settings are excluded from this repository.

[MIT License](LICENSE). User contributions and third-party materials retain their own rights. OpenCost is independent of the Kubernetes project with the same name.
