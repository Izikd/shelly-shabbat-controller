# Documentation

Notes for whoever works on this project next, human or AI agent. Start with `../AGENTS.md`
(workflow, commands, rules). This folder holds the knowledge behind those rules, one file per
topic, so each stays short.

## device/ - facts about the Shelly
What the script engine, firmware and hardware actually do. Read before changing code that runs
on or talks to the device.
- [engine.md](device/engine.md) - script engine limits: stack, missing JS features, per-script limits
- [script-code.md](device/script-code.md) - `Script.GetCode` / `PutCode`: byte ranges, read size, UTF-8, errors
- [memory.md](device/memory.md) - script memory pool, what costs memory and what does not
- [switch-time-kvs.md](device/switch-time-kvs.md) - relay, time sync, KVS, system status fields
- [network.md](device/network.md) - behaviour through a reverse proxy / tunnel

## experiments/ - what was measured and decided
Dated entries: question, method, numbers, decision. Read before re-trying something or
undoing a decision.
- [table-generation.md](experiments/table-generation.md) - hdate vs the ESPHome table, astral, pinning
- [uploads-and-reads.md](experiments/uploads-and-reads.md) - uploading code, the large-read reboot, dropped requests, read size vs memory
- [minification.md](experiments/minification.md) - minifying the controller vs its memory use
- [page-size-and-load.md](experiments/page-size-and-load.md) - page size options, load times, the request chain, ideas not tried

## Adding notes
- A new fact about the device goes in the matching `device/` file (or a new one), marked
  *doc*, *measured*, *observed* or *design*, with the firmware version if it differs.
- A measurement goes in the matching `experiments/` file as a dated `##` entry:
  **Question / Method / Result / Decision**. Numbers, not impressions; say what was not tested.
- A new file gets a line in this index.
- No device addresses, hostnames or passwords: the repository may become public.
