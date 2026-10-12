# SpecTrail distribution and website

Use the repository-local SpecTrail skill at `.agents/skills/spec-trail/SKILL.md` to track product changes in `docs/project/`. The skill path is a relative symlink to the distributed `skills/spec-trail/` package, so workflow checks use the same rules without copying the package.

`main` is the integration branch; develop on `codex/` branches. GitHub currently has no server-side branch protection. Enable the shared commit validator in a new clone with `git config core.hooksPath .githooks`. It validates staged SpecTrail state documents and does not replace workflow review.

The public website lives in `website/`. Build and validate using the commands in `website/README.md`. Keep public copy grounded in the distributed skill and current OpenFolio behavior; clearly distinguish interactive examples from running services.

OpenFolio's sync workflow owns `skills/spec-trail/`. Website work must preserve that package and `LICENSE`.
