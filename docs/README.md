# Sentinel Documentation

This directory is the single source of truth for project documentation.

| Document | Purpose |
| --- | --- |
| [Project story](project-story.md) | Why Sentinel exists and one complete risk-review narrative |
| [Product](product.md) | Product scope, screens, agents, and operating behavior |
| [Screen guide](screen-guide.md) | What every screen shows and how operators use it |
| [Operational workflows](operational-workflows.md) | End-to-end payment, case, simulation, decision, and halt flows |
| [Domain glossary](domain-glossary.md) | Canonical business language used by the UI, code, and documentation |
| [Architecture](architecture.md) | Runtime components, data flow, persistence, and security boundaries |
| [Setup and operations](setup-and-operations.md) | Local setup, Docker services, validation, and troubleshooting |
| [Configuration](configuration.md) | Environment variables and LLM assignment rules |
| [API reference](api-reference.md) | Current Next.js API endpoints and access expectations |
| [Data and simulation](data-and-simulation.md) | Baseline data, synthetic ingestion, scoring, graph, and replay behavior |
| [Access control](access-control.md) | Authentication flows, roles, capabilities, and development accounts |

## Documentation policy

- Update the relevant document in the same change as runtime behavior.
- Describe simulated data as synthetic; do not imply connection to a payment processor.
- Keep secrets out of documentation and committed environment files.
- Prefer links to stable modules over line-number references.
- Historical prompts, generated mirrors, screenshots, and gap analyses are not authoritative documentation.

## Recommended reading paths

**Product or demonstration:** Project story -> Product -> Screen guide -> Operational workflows.

**Engineering:** Architecture -> Data and simulation -> API reference -> Configuration -> Setup and operations.

**Operations or administration:** Screen guide -> Operational workflows -> Access control -> Setup and operations.
