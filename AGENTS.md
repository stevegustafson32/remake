# For AI agents

A user sent you here to remake a website. Read [`plugins/remake/skills/remake/SKILL.md`](plugins/remake/skills/remake/SKILL.md) and follow it from step 0. It installs this repo's engine into `~/.remake` (on Steve's Mac the working clone is `~/remake`) and drives it to a finish line printed by `remake report`. This is a fork of rubenhassid1/remake with the Vercel hosting step removed: remakes stay local and in a private repo.

Working on this repo itself (not using it): the engine is `engine/` (Node ESM, no build step), templates for each remake project are in `engine/templates/`, the Claude Code plugin is `plugins/remake/`. Run `npm run check` before committing.
