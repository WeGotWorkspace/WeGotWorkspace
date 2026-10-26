# Plain language in GitHub issues

Every issue has a human reader who decides whether, when, and in which order the work happens. Most issues are now drafted by agents, so the text must stay readable and auditable by people. Write for the reader of each part, not for the agent that will implement it.

Language stays English: [english-only.md](english-only.md). This page sets the **level** of that English.

## Readers and levels

| Where | Reader | Level |
|-------|--------|-------|
| Goal (Product repository), every section | Customers and the product lead | **Plain English, CEFR B1.** No code, file paths, package names, endpoints, protocol names, or internal component names. |
| `Summary` at the top of an Epic, Task, Chore, or Bug | The product lead | **Plain English, B1.** At most three short sentences, no code. |
| Everything below the `Summary` | A medior developer | **Technical English, B2.** Jargon is fine. Explain an internal name the first time it appears, and link a file instead of pasting its reasoning. |

B1 means: sentences under about 20 words, one point per sentence, common words, active voice, concrete subjects ("you", "the admin", "Drive"). Many readers are not native English speakers.

## The Summary block

Every Epic, Task, Chore, and Bug body starts with this block. Bug reports from outside contributors are the exception: a maintainer adds the block during triage.

```markdown
## Summary

**What:** <what is wrong, or what changes, in one sentence>
**Who notices:** <which users or admins see the difference, and when>
**If we wait:** <what happens if this is not done now: data loss, a blocked Goal, a workaround, or nothing visible>
```

The product lead should be able to rank the issue from these three lines alone. Do not put code, file names, or issue numbers in them; links to the parent Goal or Epic go in the parent field below.

Good:

> **What:** Text typed in a note while offline can be lost when you switch to another note.
>
> **Who notices:** Anyone who edits notes on a train or a bad connection.
>
> **If we wait:** People lose writing without a warning. This blocks the offline Notes Goal.

Not good:

> **What:** `useDocsCollabSave` skips the dirty flag when `lastKnownMarkdown` is empty, so the outbox never enqueues.

That sentence belongs in the technical part below the Summary.

## Goals stay product language

A Goal says what a person can do and how we know it works. It does not say how it is built.

- **Outcome, Who it's for, Success looks like, Non-goals:** B1, written from the user's side ("I can …", "The admin sees …").
- **Decisions:** product decisions only, in plain words: what the user gets, what we chose not to do, and why.
- **Length:** aim for at most about 400 words above the Delivery section. A Goal that needs more is usually two Goals, or holds engineering detail.

### Where technical content goes

Technical content is **moved, never deleted.** Data models, storage, protocols, file paths, branch strategy, open engineering questions, and verification notes belong in the code repository:

1. Put it in the **Epic** under that Goal, in a section such as `## Technical design` or `## From the Goal`. If the Goal has no Epic yet, file one and attach it as a sub-issue of the Goal.
2. If it is very long, put it in a doc under `docs/architecture/` and link that doc from the Epic.
3. In the Goal, replace the moved text with one plain sentence and a link, for example: "The technical design is in Epic WeGotWorkspace/WeGotWorkspace#1499."
4. In the Epic, say where the text came from: "Moved from WeGotWorkspace/Product#137 on <date>."

When you clean up an existing Goal, show the maintainer which text moves to which Epic before you edit either issue.

## Check before you file

Before `gh issue create` or `gh issue edit`:

1. Read only the title and the `Summary` (or, for a Goal, only Outcome and Success looks like). Could the product lead decide on this without reading further?
2. Search the Goal or `Summary` for backticks, slashes, file extensions, and CamelCase names. Each one is a sign that technical text is in the wrong place.
3. Read the technical part as a medior developer new to this area. Is every internal name explained or linked the first time?
